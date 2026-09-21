import crypto from 'node:crypto'
import { db } from '../../config/database.js'
import { isClubPlan, isPaidPlan } from '../../lib/capabilities.js'
import { env } from '../../config/env.js'
import {
  allOwedRewards,
  ladderProgress,
  emptyCounts,
  totalMonthsEarned,
  type LadderCounts,
  type LadderProgress,
  type ReferralKind,
  type ReferrerTier,
} from '../../lib/referral-ladder.js'
import { applyPendingCredit } from './referral-credit.service.js'

// Ambiguous glyphs are gone: a code gets read off a phone screen and typed by
// someone else, and 0/O and 1/I/L are where that goes wrong.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const SUFFIX_LEN = 5

function randomSuffix(): string {
  const bytes = crypto.randomBytes(SUFFIX_LEN)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

/**
 * The coach's own invite code, minted on first use and never changed after —
 * a code that can change is a code that stops crediting the person who printed
 * it on a slide six months ago.
 */
export async function ensureReferralCode(userId: number): Promise<string> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { referralCode: true, name: true },
  })
  if (user.referralCode) return user.referralCode

  // First name as a readable prefix, so a coach saying their code aloud sounds
  // like a recommendation rather than a serial number.
  const prefix = (user.name || 'COACH').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'COACH'

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = `${prefix}-${randomSuffix()}`
    try {
      await db.user.update({ where: { id: userId }, data: { referralCode: code } })
      return code
    } catch {
      // Unique collision — try another suffix. 31^5 ≈ 28.6M per prefix, so this
      // is a formality, but a formality that must not hand back a duplicate.
    }
  }
  throw new Error('Could not allocate a referral code')
}

export function referralLink(code: string): string {
  return `${env.FRONTEND_URL.replace(/\/$/, '')}/signup?ref=${encodeURIComponent(code)}`
}

/**
 * Record who introduced a brand-new account. Called from signup only: being
 * referred is decided once and never reassigned, so a coach cannot be
 * retro-claimed by whoever asks last.
 *
 * Never throws — a bad or self-referring code must not stop someone signing up.
 */
export async function attachReferral(newUserId: number, rawCode: string | null | undefined): Promise<void> {
  const code = rawCode?.trim().toUpperCase()
  if (!code) return

  const referrer = await db.user.findUnique({
    where: { referralCode: code },
    select: { id: true },
  })
  if (!referrer || referrer.id === newUserId) return

  try {
    await db.referral.create({ data: { referrerId: referrer.id, referredUserId: newUserId, code } })
  } catch {
    // Already referred (unique on referred_user_id). First claim wins.
  }
}

/**
 * The referred coach's first payment has cleared — the only event that turns a
 * referral into something owed. Signing up earns nothing, which is what makes
 * farming fake accounts pointless.
 *
 * Safe to call repeatedly: Stripe retries webhooks, and a coach's second and
 * third invoices arrive at this same door.
 */
export async function qualifyReferral(referredUserId: number): Promise<void> {
  const referral = await db.referral.findUnique({
    where: { referredUserId },
    select: { id: true, referrerId: true, status: true },
  })
  if (!referral || referral.status !== 'pending') return

  // The referrer has to be paying us.
  //
  // The whole ladder pays in free months, which are worth exactly nothing to
  // someone on the free tier — and worse, granting them would quietly comp a
  // subscription nobody bought. So a free coach's referrals STAY PENDING
  // rather than being thrown away: the moment that coach starts paying,
  // `qualifyPendingFor` below sweeps them up and they are paid in full.
  //
  // That turns the free tier's referrals into an upgrade argument instead of
  // a dead end — "you have three waiting" is a far better reason to subscribe
  // than anything on the pricing page — and it costs us nothing, because the
  // three coaches they brought are already paying.
  if (!isPaidPlan(await planSlugOf(referral.referrerId))) return

  const [kind, referrerTier] = await Promise.all([
    kindOf(referredUserId),
    tierOf(referral.referrerId),
  ])

  await db.referral.update({
    where: { id: referral.id },
    data: { status: 'qualified', qualifiedAt: new Date(), kind, referrerTier },
  })
  await syncRewards(referral.referrerId)
}

/**
 * A coach has just started paying — settle anything their referrals already
 * earned while they were on the free tier.
 *
 * Only referrals whose own customer has ALREADY paid qualify here; the rest
 * stay pending and are picked up by `qualifyReferral` as they pay, exactly as
 * before. So this can never pay for a signup, only for a sale.
 */
export async function qualifyPendingFor(referrerId: number): Promise<void> {
  if (!isPaidPlan(await planSlugOf(referrerId))) return

  const pending = await db.referral.findMany({
    where: { referrerId, status: 'pending' },
    select: { referredUserId: true },
  })
  // Sequential, not Promise.all: each one ends in a `syncRewards` that
  // recomputes the whole ledger from the referral counts, and running several
  // of those concurrently races them against each other on the same rows.
  for (const { referredUserId } of pending) {
    if (await hasPaid(referredUserId)) await qualifyReferral(referredUserId)
  }
}

/** Has this account ever actually paid — the only thing that earns a reward. */
async function hasPaid(userId: number): Promise<boolean> {
  const sub = await db.userSubscription.findUnique({
    where: { userId },
    select: { status: true, plan: { select: { slug: true } } },
  })
  // 'trial' is deliberately not enough. Nothing is earned until money moves,
  // which is what makes farming free accounts pointless.
  return !!sub && sub.status !== 'trial' && isPaidPlan(sub.plan.slug)
}

/** The plan slug an account holds, or null if it has no subscription. */
async function planSlugOf(userId: number): Promise<string | null> {
  const sub = await db.userSubscription.findUnique({
    where: { userId },
    select: { plan: { select: { slug: true } } },
  })
  return sub?.plan.slug ?? null
}

/**
 * What the new customer BOUGHT — which ladder they land on.
 *
 * Recorded on the referral at qualification and then left alone, so a coach
 * who later upgrades does not silently re-bucket a referral that was already
 * paid out on.
 */
async function kindOf(userId: number): Promise<ReferralKind> {
  const slug = await planSlugOf(userId)
  if (isClubPlan(slug)) return 'club'
  if (slug === 'player') return 'player'
  return 'coach'
}

/**
 * What the REFERRER is on — which thresholds apply to them.
 *
 * Only two sets of thresholds exist, because they are set by what a free month
 * COSTS us. A player who refers someone is rewarded in player months, which
 * are cheap, so they sit on the coach thresholds rather than needing a third
 * column of their own.
 */
async function tierOf(userId: number): Promise<ReferrerTier> {
  return isClubPlan(await planSlugOf(userId)) ? 'club' : 'coach'
}

/** A refund or chargeback: the referral stops counting and the ladder recomputes. */
export async function reverseReferral(referredUserId: number): Promise<void> {
  const referral = await db.referral.findUnique({
    where: { referredUserId },
    select: { id: true, referrerId: true, status: true },
  })
  if (!referral || referral.status === 'reversed') return

  await db.referral.update({
    where: { id: referral.id },
    data: { status: 'reversed', reversedAt: new Date() },
  })
  await syncRewards(referral.referrerId)
}

/**
 * Bring the reward ledger in line with the referral count.
 *
 * Recomputed wholesale rather than incremented, so a duplicate webhook, two
 * payments landing together or a replayed event all converge on the same
 * answer. The (user, cycle, tier) unique key is what makes the insert safe.
 */
export async function syncRewards(userId: number): Promise<void> {
  const counts = await qualifiedCounts(userId)
  const owed = allOwedRewards(counts)
  const key = (r: { referrerTier: string; kind: string; cycle: number; tier: number }) =>
    `${r.referrerTier}:${r.kind}:${r.cycle}:${r.tier}`
  const owedKeys = new Set(owed.map(key))

  const existing = await db.referralReward.findMany({ where: { userId } })
  const existingKeys = new Set(existing.map(key))

  for (const reward of owed) {
    if (existingKeys.has(key(reward))) continue
    try {
      await db.referralReward.create({
        data: {
          userId,
          referrerTier: reward.referrerTier,
          kind: reward.kind,
          cycle: reward.cycle,
          tier: reward.tier,
          months: reward.months,
        },
      })
    } catch {
      // Raced with a concurrent webhook; the unique key did its job.
    }
  }

  // A reversal can take the count back below a rung. Credit already spent
  // cannot be un-spent, so only rewards still sitting unapplied are revoked —
  // clawing back months a coach has already used would be a worse outcome than
  // absorbing the cost of one refund.
  for (const reward of existing) {
    const stillOwed = owedKeys.has(key(reward))
    if (!stillOwed && !reward.appliedAt && !reward.revokedAt) {
      await db.referralReward.update({ where: { id: reward.id }, data: { revokedAt: new Date() } })
    } else if (stillOwed && reward.revokedAt) {
      // They earned it back.
      await db.referralReward.update({ where: { id: reward.id }, data: { revokedAt: null } })
    }
  }

  // Pay out immediately. Credit that sits "earned" but invisible until some
  // later billing event is the single most common referral-programme support
  // ticket — the coach did the work and cannot see anything happen.
  await applyPendingCredit(userId)
}

/** Free months earned and not yet spent. */
export async function creditBalanceMonths(userId: number): Promise<number> {
  const rows = await db.referralReward.findMany({
    where: { userId, appliedAt: null, revokedAt: null },
    select: { months: true },
  })
  return rows.reduce((sum, r) => sum + r.months, 0)
}

/**
 * Paid referrals in each of the four buckets — the only input the ladders need.
 *
 * Grouped rather than four counts, so adding a tier never means remembering to
 * add another query.
 */
export async function qualifiedCounts(userId: number): Promise<LadderCounts> {
  const rows = await db.referral.groupBy({
    by: ['referrerTier', 'kind'],
    where: { referrerId: userId, status: 'qualified' },
    _count: { _all: true },
  })

  const counts = emptyCounts()
  for (const row of rows) {
    counts[row.referrerTier as ReferrerTier][row.kind as ReferralKind] = row._count._all
  }
  return counts
}

export interface ReferralSummary {
  code: string
  link: string
  /** The plan the referrer is on now — which thresholds their bars are using. */
  referrerTier: ReferrerTier
  /** Their two live ladders, already picked for their tier. */
  coach: LadderProgress
  club: LadderProgress
  /** Free months earned across every ladder, including passes made on a plan
      they have since left. Always ≥ the two bars' own totals. */
  monthsEarned: number
  pendingCount: number
  creditMonths: number
  rewards: {
    referrerTier: ReferrerTier
    kind: ReferralKind
    tier: number
    months: number
    cycle: number
    grantedAt: Date
    appliedAt: Date | null
  }[]
  /** First names only — enough to recognise who converted, without publishing
      a list of other people's email addresses to whoever invited them. */
  referred: { firstName: string; status: string; kind: ReferralKind; joinedAt: Date }[]
}

export async function getReferralSummary(userId: number): Promise<ReferralSummary> {
  const code = await ensureReferralCode(userId)
  const [referrals, rewards, counts, referrerTier] = await Promise.all([
    db.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, kind: true, createdAt: true, referred: { select: { name: true } } },
    }),
    db.referralReward.findMany({
      where: { userId, revokedAt: null },
      orderBy: { grantedAt: 'asc' },
      select: {
        referrerTier: true,
        kind: true,
        tier: true,
        months: true,
        cycle: true,
        grantedAt: true,
        appliedAt: true,
      },
    }),
    qualifiedCounts(userId),
    tierOf(userId),
  ])

  // Show the bars for the plan they are on NOW. A referrer who moved from Pro
  // to Club keeps everything already earned — `monthsEarned` counts every
  // ladders — but their progress bars restart against the Club thresholds,
  // because those are the ones the next referral will be judged by.
  return {
    code,
    link: referralLink(code),
    referrerTier,
    coach: ladderProgress(referrerTier, 'coach', counts[referrerTier].coach),
    club: ladderProgress(referrerTier, 'club', counts[referrerTier].club),
    monthsEarned: totalMonthsEarned(counts),
    pendingCount: referrals.filter((r) => r.status === 'pending').length,
    creditMonths: rewards.filter((r) => !r.appliedAt).reduce((s, r) => s + r.months, 0),
    rewards,
    referred: referrals.map((r) => ({
      firstName: r.referred.name,
      status: r.status,
      kind: r.kind,
      joinedAt: r.createdAt,
    })),
  }
}
