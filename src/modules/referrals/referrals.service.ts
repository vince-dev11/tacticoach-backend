import crypto from 'node:crypto'
import { db } from '../../config/database.js'
import { isPaidPlan } from '../../lib/capabilities.js'
import { env } from '../../config/env.js'
import {
  allOwedRewards,
  ladderProgress,
  pairKey,
  rateFor,
  totalMonthsEarned,
  type LadderProgress,
  type PairCounts,
  type PlanPrice,
  type Rate,
} from '../../lib/referral-ladder.js'
import { loadPriceBook, lookup, type PriceBook } from '../../lib/plan-prices.js'
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
 * A cleared payment from somebody who was referred.
 *
 * The only event that turns a referral into something owed. Signing up earns
 * nothing, which is what makes farming fake accounts pointless.
 *
 * Safe to call repeatedly: Stripe retries webhooks, and a coach's second and
 * third invoices arrive at this same door. `invoiceId` is what tells a retry
 * of the same payment from a genuinely new one — without it a single payment
 * replayed twice would clear the monthly bar below on its own.
 */
export async function qualifyReferral(referredUserId: number, invoiceId?: string): Promise<void> {
  const referral = await db.referral.findUnique({
    where: { referredUserId },
    select: {
      id: true,
      referrerId: true,
      status: true,
      firstInvoiceId: true,
      firstPaymentAt: true,
      secondPaymentAt: true,
    },
  })
  if (!referral || referral.status === 'reversed' || referral.status === 'qualified') return

  // Record the payment BEFORE looking at the referrer's own plan. A referrer
  // on the free tier still has their referrals' payments counted; those
  // referrals just sit pending until the referrer starts paying, and
  // `qualifyPendingFor` settles them then. Counting only once the referrer
  // pays would lose the history and make the sweep pay for a signup.
  const payments = advancePayments(referral, invoiceId)
  if (payments) await db.referral.update({ where: { id: referral.id }, data: payments })

  const first = payments?.firstPaymentAt ?? referral.firstPaymentAt
  const second = payments?.secondPaymentAt ?? referral.secondPaymentAt
  if (!first) return

  const plan = await subscriptionOf(referredUserId)
  if (!plan || !isPaidPlan(plan.slug)) return

  // THE MONTHLY BAR.
  //
  // An annual customer has handed over twelve months on day one, so the
  // reward is safe the moment it is earned. A monthly customer has paid one
  // instalment — £4.99 on Basic — against a reward that can be worth more
  // than that. Waiting one cycle costs a legitimate referrer a month's
  // patience and caps what an immediate churn can take out of us.
  //
  // Anything that is not explicitly monthly is treated as annual: a legacy
  // row with no billing cycle is far more likely to be an annual purchase
  // than a trap, and holding a real referrer's reward hostage to a null
  // column is the worse failure.
  if (plan.billingCycle === 'monthly' && !second) return

  // The referrer has to be paying us.
  //
  // The whole programme pays in free months, which are worth exactly nothing
  // to someone on the free tier — and worse, granting them would quietly comp
  // a subscription nobody bought. So a free coach's referrals STAY PENDING
  // rather than being thrown away: the moment that coach starts paying,
  // `qualifyPendingFor` below sweeps them up and they are paid in full.
  //
  // That turns the free tier's referrals into an upgrade argument instead of
  // a dead end — "you have three waiting" is a far better reason to subscribe
  // than anything on the pricing page — and it costs us nothing, because the
  // people they brought are already paying.
  const referrerPlan = await planSlugOf(referral.referrerId)
  if (!isPaidPlan(referrerPlan)) return

  await db.referral.update({
    where: { id: referral.id },
    data: {
      status: 'qualified',
      qualifiedAt: new Date(),
      referredPlan: plan.slug,
      referrerPlan: referrerPlan!,
    },
  })
  await syncRewards(referral.referrerId)
}

/**
 * Which payment timestamps this invoice moves, or null if it moves none.
 *
 * Idempotent on the invoice id: replaying the first invoice matches
 * `firstInvoiceId` and changes nothing, and once a second payment is recorded
 * no later invoice touches it again. A call with no invoice id — the sweep in
 * `qualifyPendingFor`, which fires on the REFERRER's payment rather than the
 * referred customer's — deliberately advances nothing.
 */
function advancePayments(
  referral: { firstInvoiceId: string | null; firstPaymentAt: Date | null; secondPaymentAt: Date | null },
  invoiceId: string | undefined,
): { firstPaymentAt?: Date; firstInvoiceId?: string; secondPaymentAt?: Date } | null {
  if (!invoiceId) return null
  if (!referral.firstPaymentAt) {
    return { firstPaymentAt: new Date(), firstInvoiceId: invoiceId }
  }
  if (referral.firstInvoiceId !== invoiceId && !referral.secondPaymentAt) {
    return { secondPaymentAt: new Date() }
  }
  return null
}

/**
 * A coach has just started paying — settle anything their referrals already
 * earned while they were on the free tier.
 *
 * Only referrals that have already met their own payment bar qualify here;
 * the rest stay pending and are picked up by `qualifyReferral` as they pay,
 * exactly as before. So this can never pay for a signup, only for a sale.
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
    await qualifyReferral(referredUserId)
  }
}

/** The plan and billing cycle an account holds, or null if it has none. */
async function subscriptionOf(
  userId: number,
): Promise<{ slug: string; billingCycle: string | null; status: string } | null> {
  const sub = await db.userSubscription.findUnique({
    where: { userId },
    select: { status: true, billingCycle: true, plan: { select: { slug: true } } },
  })
  // 'trial' is deliberately not enough. Nothing is earned until money moves,
  // which is what makes farming free accounts pointless.
  if (!sub || sub.status === 'trial') return null
  return { slug: sub.plan.slug, billingCycle: sub.billingCycle, status: sub.status }
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
 * A refund or chargeback: the referral stops counting and the ledger
 * recomputes.
 *
 * NOT called on cancellation, deliberately. A customer who pays for three
 * months and then leaves has still paid us for three months; clawing the
 * reward back from the person who introduced them would be taking it for
 * revenue we actually banked, and it is not the referrer's doing. The
 * protection against a short-lived customer is the monthly bar above — make
 * them pay twice before anything is owed — not a reversal after the fact.
 * A refund is different: that money went back.
 */
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
 * answer. The (user, referrerPlan, referredPlan, cycle) unique key is what
 * makes the insert safe.
 */
export async function syncRewards(userId: number): Promise<void> {
  const [counts, book] = await Promise.all([qualifiedCounts(userId), loadPriceBook()])
  const owed = allOwedRewards(counts, lookup(book))
  const key = (r: { referrerPlan: string; referredPlan: string; cycle: number }) =>
    `${r.referrerPlan}:${r.referredPlan}:${r.cycle}`
  const owedKeys = new Set(owed.map(key))

  const existing = await db.referralReward.findMany({ where: { userId } })
  const existingKeys = new Set(existing.map(key))

  for (const reward of owed) {
    if (existingKeys.has(key(reward))) continue
    try {
      await db.referralReward.create({
        data: {
          userId,
          referrerPlan: reward.referrerPlan,
          referredPlan: reward.referredPlan,
          cycle: reward.cycle,
          every: reward.every,
          months: reward.months,
        },
      })
    } catch {
      // Raced with a concurrent webhook; the unique key did its job.
    }
  }

  // A reversal can take the count back below an award. Credit already spent
  // cannot be un-spent, so only rewards still sitting unapplied are revoked —
  // clawing back months a coach has already used would be a worse outcome
  // than absorbing the cost of one refund.
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
 * Paid referrals per (referrer plan, referred plan) pairing — the only input
 * the rate engine needs.
 *
 * Grouped rather than counted one pairing at a time, so adding a plan never
 * means remembering to add another query.
 */
export async function qualifiedCounts(userId: number): Promise<PairCounts> {
  const rows = await db.referral.groupBy({
    by: ['referrerPlan', 'referredPlan'],
    where: { referrerId: userId, status: 'qualified' },
    _count: { _all: true },
  })

  const counts: PairCounts = new Map()
  for (const row of rows) {
    counts.set(pairKey(row.referrerPlan, row.referredPlan), row._count._all)
  }
  return counts
}

/** One row of the rate card: what this referrer earns for one plan. */
export interface RateCardEntry {
  /** The plan the new customer would buy. */
  plan: string
  /** Its product name — "Club 20". Not translated; it is a product name. */
  planName: string
  rate: Rate
  /** How many of this plan they have already brought in. */
  qualified: number
  monthsEarned: number
  next: { inMore: number; months: number }
}

export interface ReferralSummary {
  code: string
  link: string
  /** The plan the referrer is on now — which rates their card is showing. */
  referrerPlan: string
  /**
   * What they earn for each plan somebody could buy, at today's prices.
   *
   * Sent as a list rather than two fixed ladders because there is no longer a
   * fixed number of them: the rate is computed per plan pair, so the card has
   * a row for every plan we sell and gains one automatically when we add one.
   */
  rateCard: RateCardEntry[]
  /** Free months earned across every pairing, including plans they have left. */
  monthsEarned: number
  pendingCount: number
  creditMonths: number
  rewards: {
    referrerPlan: string
    referredPlan: string
    every: number
    months: number
    cycle: number
    grantedAt: Date
    appliedAt: Date | null
  }[]
  /**
   * First names only — enough to recognise who converted, without publishing
   * a list of other people's email addresses to whoever invited them.
   *
   * `awaitingSecondPayment` is why a referral that has clearly paid can still
   * read as pending: they are on monthly and one instalment in. Saying so is
   * the difference between a progress note and a support ticket.
   */
  referred: {
    firstName: string
    status: string
    plan: string
    planName: string
    joinedAt: Date
    awaitingSecondPayment: boolean
  }[]
}

export async function getReferralSummary(userId: number): Promise<ReferralSummary> {
  const code = await ensureReferralCode(userId)
  const [referrals, rewards, counts, currentPlan, book] = await Promise.all([
    db.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        status: true,
        referredPlan: true,
        createdAt: true,
        firstPaymentAt: true,
        secondPaymentAt: true,
        referred: { select: { name: true } },
      },
    }),
    db.referralReward.findMany({
      where: { userId, revokedAt: null },
      orderBy: { grantedAt: 'asc' },
      select: {
        referrerPlan: true,
        referredPlan: true,
        every: true,
        months: true,
        cycle: true,
        grantedAt: true,
        appliedAt: true,
      },
    }),
    qualifiedCounts(userId),
    planSlugOf(userId),
    loadPriceBook(),
  ])

  // Show the card for the plan they are on NOW. A referrer who moved from Pro
  // to Club keeps everything already earned — `monthsEarned` counts every
  // pairing — but what the next referral pays is judged by the new plan.
  const referrerPlan = currentPlan ?? 'free'
  const referrerPrice = book.get(referrerPlan)

  return {
    code,
    link: referralLink(code),
    referrerPlan,
    rateCard: buildRateCard(referrerPlan, referrerPrice, book, counts),
    monthsEarned: totalMonthsEarned(counts, lookup(book)),
    pendingCount: referrals.filter((r) => r.status === 'pending').length,
    creditMonths: rewards.filter((r) => !r.appliedAt).reduce((s, r) => s + r.months, 0),
    rewards,
    referred: referrals.map((r) => ({
      firstName: r.referred.name,
      status: r.status,
      plan: r.referredPlan,
      planName: book.get(r.referredPlan)?.name ?? r.referredPlan,
      joinedAt: r.createdAt,
      awaitingSecondPayment:
        r.status === 'pending' && r.firstPaymentAt != null && r.secondPaymentAt == null,
    })),
  }
}

/**
 * The rate card for one referrer, over every plan worth showing.
 *
 * Plans with no annual price are skipped: the cap is measured against a first
 * year, and a plan that cannot be bought for a year has no denominator. That
 * also quietly drops the free and retired-player rows, which is the right
 * answer for a page that is telling a coach what they can earn.
 */
function buildRateCard(
  referrerPlan: string,
  referrer: PlanPrice | undefined,
  book: PriceBook,
  counts: PairCounts,
): RateCardEntry[] {
  if (!referrer || referrer.monthlyPence <= 0) return []
  const entries: RateCardEntry[] = []
  for (const referred of book.values()) {
    if (referred.annualPence <= 0) continue
    const rate = rateFor(referrer, referred)
    if (rate.months <= 0) continue
    const qualified = counts.get(pairKey(referrerPlan, referred.slug)) ?? 0
    const progress: LadderProgress = ladderProgress(referrer, referred, qualified)
    entries.push({
      plan: referred.slug,
      planName: referred.name ?? referred.slug,
      rate,
      qualified,
      monthsEarned: progress.monthsEarned,
      next: progress.next,
    })
  }
  // Cheapest plan first, which is the order a coach reads a price list in.
  return entries.sort((a, b) => {
    const pa = book.get(a.plan)?.annualPence ?? 0
    const pb = book.get(b.plan)?.annualPence ?? 0
    return pa - pb
  })
}
