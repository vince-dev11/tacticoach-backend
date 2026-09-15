// The referral ladders: how many customers you have to bring, and what you get.
//
// FOUR ladders, from two independent questions:
//
//   Who is referring?      A Pro coach, or a Club. A free month is worth £2.99
//                          to one and £24.99 to the other, so a Club has to
//                          bring roughly twice as many people for the same
//                          reward. Otherwise the same programme costs eight
//                          times more for the accounts most able to work it.
//
//   Who did they bring?    A coach, or a club. A club is worth about eight
//                          coaches, so it pays from the very first one.
//
//   Referrer   Brings coaches          Brings clubs
//   Pro         3 → 1   8 → 3   12 → 12    1 → 3   2 → 6   3 → 12
//   Club        6 → 1  16 → 3   24 → 12    2 → 3   3 → 6   6 → 12
//
// Those month figures are RUNNING TOTALS — "8 coaches → 3 months" means you now
// hold 3, not 3 more. The rungs below are stored as the increment each one
// adds, because that is what a ledger row has to be, and `cumulativeAt` turns
// them back into the totals above. Getting that backwards silently pays 16
// months where 12 was promised, so the tests assert the totals.
//
// Everything here is a PURE function of one number — the count of referrals of
// one kind that have actually paid. That is what makes webhook retries,
// simultaneous payments and a refund three months later stop being special
// cases: "what is owed" can always be recomputed from scratch and compared
// with what was already granted.

/** The plan the REFERRER is on. Decides which thresholds apply to them. */
export type ReferrerTier = 'coach' | 'club'

/** What the REFERRED customer bought. Decides which ladder they land on. */
export type ReferralKind = 'coach' | 'club'

/** A rung: reach `at` paid referrals in a cycle, get `months` more free. */
export interface Tier {
  at: number
  months: number
}

/**
 * Increments that reach the promised totals.
 *   coach ladder: 1, +2, +9  → 1 / 3 / 12
 *   club ladder:  3, +3, +6  → 3 / 6 / 12
 * Only the thresholds differ between a Pro and a Club referrer; the rewards
 * themselves are the same, which is why these two lists are shared.
 */
const COACH_STEPS = [1, 2, 9] as const
const CLUB_STEPS = [3, 3, 6] as const

const rungs = (ats: readonly number[], steps: readonly number[]): readonly Tier[] =>
  ats.map((at, i) => ({ at, months: steps[i] }))

export const LADDERS: Record<ReferrerTier, Record<ReferralKind, readonly Tier[]>> = {
  coach: {
    coach: rungs([3, 8, 12], COACH_STEPS),
    club: rungs([1, 2, 3], CLUB_STEPS),
  },
  club: {
    coach: rungs([6, 16, 24], COACH_STEPS),
    club: rungs([2, 3, 6], CLUB_STEPS),
  },
}

export function tiersFor(referrer: ReferrerTier, kind: ReferralKind): readonly Tier[] {
  return LADDERS[referrer][kind]
}

/** Reaching the top rung closes a cycle; the ladder then starts again at zero. */
export function cycleLength(referrer: ReferrerTier, kind: ReferralKind): number {
  const tiers = tiersFor(referrer, kind)
  return tiers[tiers.length - 1].at
}

export interface OwedReward {
  referrerTier: ReferrerTier
  kind: ReferralKind
  /** 1-based pass through the ladder. */
  cycle: number
  tier: number
  months: number
}

/**
 * Every reward earned for `qualified` paid referrals on one ladder, in the
 * order they were earned.
 *
 * A cycle completes at the top rung and the next referral starts the next one,
 * so a Pro coach who brings 3 clubs earns 12 months and 6 clubs earns 24.
 */
export function owedRewards(
  referrer: ReferrerTier,
  kind: ReferralKind,
  qualified: number,
): OwedReward[] {
  if (qualified <= 0) return []

  const tiers = tiersFor(referrer, kind)
  const length = cycleLength(referrer, kind)
  const out: OwedReward[] = []
  const completeCycles = Math.floor(qualified / length)
  const remainder = qualified % length

  const push = (cycle: number, t: Tier) =>
    out.push({ referrerTier: referrer, kind, cycle, tier: t.at, months: t.months })

  for (let cycle = 1; cycle <= completeCycles; cycle++) {
    for (const t of tiers) push(cycle, t)
  }
  for (const t of tiers) {
    if (remainder >= t.at) push(completeCycles + 1, t)
  }
  return out
}

/** A referral count for each of the four ladders. */
export type LadderCounts = Record<ReferrerTier, Record<ReferralKind, number>>

export const emptyCounts = (): LadderCounts => ({
  coach: { coach: 0, club: 0 },
  club: { coach: 0, club: 0 },
})

/** Everything owed across all four ladders. */
export function allOwedRewards(counts: LadderCounts): OwedReward[] {
  const out: OwedReward[] = []
  for (const referrer of ['coach', 'club'] as ReferrerTier[]) {
    for (const kind of ['coach', 'club'] as ReferralKind[]) {
      out.push(...owedRewards(referrer, kind, counts[referrer][kind]))
    }
  }
  return out
}

/** Total free months earned on one ladder. */
export function monthsEarned(
  referrer: ReferrerTier,
  kind: ReferralKind,
  qualified: number,
): number {
  return owedRewards(referrer, kind, qualified).reduce((sum, r) => sum + r.months, 0)
}

/** Total across all four. */
export function totalMonthsEarned(counts: LadderCounts): number {
  return allOwedRewards(counts).reduce((sum, r) => sum + r.months, 0)
}

/**
 * Running total a referrer has earned at a rung — "2 clubs = 6 months" — rather
 * than the increment the rung itself pays.
 *
 * This is the number the programme was specified in and the one the UI must
 * show: "2 clubs → 3 months" sitting under "1 club → 3 months" reads as though
 * the second club was worth nothing.
 */
export function cumulativeAt(referrer: ReferrerTier, kind: ReferralKind, at: number): number {
  return tiersFor(referrer, kind)
    .filter((t) => t.at <= at)
    .reduce((sum, t) => sum + t.months, 0)
}

export interface LadderProgress {
  referrerTier: ReferrerTier
  kind: ReferralKind
  qualified: number
  /** Where they are within the current pass: 0 … cycleLength - 1. */
  inCycle: number
  cycle: number
  monthsEarned: number
  /** The next rung, with the TOTAL it takes them to. Null when the pass is done. */
  next: { at: number; months: number; remaining: number } | null
  /** Rungs labelled with running totals, ready to render. */
  tiers: { at: number; months: number; reached: boolean }[]
}

/**
 * Everything the progress UI needs, with the months already converted to
 * totals. Kept here rather than in the route so the numbers a coach reads on
 * screen come from the same source as the numbers we pay out on — a progress
 * bar that disagrees with the ledger is a support ticket that takes an hour
 * to unpick.
 */
export function ladderProgress(
  referrer: ReferrerTier,
  kind: ReferralKind,
  qualified: number,
): LadderProgress {
  const safe = Math.max(0, qualified)
  const length = cycleLength(referrer, kind)
  const tiers = tiersFor(referrer, kind)
  const inCycle = safe % length
  const upcoming = tiers.find((t) => inCycle < t.at)

  return {
    referrerTier: referrer,
    kind,
    qualified: safe,
    inCycle,
    cycle: Math.floor(safe / length) + 1,
    monthsEarned: monthsEarned(referrer, kind, safe),
    next: upcoming
      ? {
          at: upcoming.at,
          months: cumulativeAt(referrer, kind, upcoming.at),
          remaining: upcoming.at - inCycle,
        }
      : null,
    tiers: tiers.map((t) => ({
      at: t.at,
      months: cumulativeAt(referrer, kind, t.at),
      reached: inCycle >= t.at,
    })),
  }
}
