// What a referrer earns, DERIVED FROM PRICES rather than written down.
//
// One rule, and the whole programme falls out of it:
//
//     A referral never pays out more than 10% of what that customer
//     pays us in their first year.
//
// Nothing here is a hand-chosen number. Give this file what a free month
// costs us (the referrer's monthly price) and what the new customer brings in
// (their annual price) and it returns the most generous reward that still
// fits under the cap. That is the entire design.
//
// ---- Why it is computed and not tabled ---------------------------------
//
// The previous version had a table: two referrer tiers × two referred kinds,
// four numbers, edited by hand. Three things were wrong with it.
//
//   * BASIC HAD NOWHERE TO GO. There were two referrer tiers, coach and club,
//     so a Basic subscriber was silently put on the Pro rate. Nobody decided
//     that; it fell out of `isClubPlan(slug) ? 'club' : 'coach'`.
//   * THE COST GUARD WAS FICTION. It assumed every referred coach bought Pro
//     at £79. Referred coaches buy Basic too, at £45, and against that a
//     Club 20's free month cost 39% — worse than the 44% blow-out the table
//     was written to fix.
//   * A PRICE CHANGE COULD BREACH IT SILENTLY. The rates lived here and the
//     prices lived in prisma/plans.ts, and nothing tied the two together.
//
// Computing from prices fixes all three at once. There is no tier to fall
// onto, the denominator is the real price of the real plan, and a price edit
// moves the rate with it instead of quietly invalidating it.
//
// ---- What it produces, at today's prices --------------------------------
//
//   you're on ↓   they buy →  Basic      Pro       Club 5    Club 10   Club 20
//   Basic  £4.99/mo           1 per 2    1 mo      5 mo      8 mo      14 mo
//   Pro    £8.99/mo           1 per 2    1 per 2   2 mo      4 mo      7 mo
//   Club 5  £24.99/mo         1 per 6    1 per 4   1 mo      1 mo      2 mo
//   Club 10 £39.99/mo         1 per 9    1 per 6   1 per 2   1 mo      1 mo
//   Club 20 £69.99/mo         1 per 16   1 per 9   1 per 3   1 per 2   1 mo
//
// Two things in that grid are worth understanding before anybody edits a
// price.
//
// MONTHS INVERT, AND THAT IS CORRECT. A Basic coach earns 14 months for
// bringing a Club 20; a Club 20 earns half that for bringing one. Both
// received about £60 of value. A Club 20 month is fourteen times a Basic
// month, so the same money buys fourteen times fewer of them. Nobody is
// short-changed — "months" is just a unit that stretches.
//
// THE DIAGONAL IS THE TIGHT ONE. Refer somebody onto your own plan and the
// reward is one month against roughly ten months of revenue, which lands
// within a hair of the cap either side of it. Club annual prices are exactly
// ten times monthly (£250/£400/£700), so one free month is 9.99% and fits.
// Basic and Pro annual are ~nine times monthly — the deeper "3 months free"
// discount — so one free month is 11% there and does NOT fit, which is why
// their diagonal reads "1 per 2". If anybody ever wonders why Pro can't earn
// a month for one Pro referral, that is the reason, and it is arithmetic
// rather than policy.
//
// ---- The property everything else depends on ----------------------------
//
// What is owed is a PURE function of one number: how many referrals of one
// (referrer plan, referred plan) pair have actually paid. That is what stops
// webhook retries, simultaneous payments and a refund three months later from
// being special cases — "what is owed" can always be recomputed from scratch
// and compared against what has already been granted.

/**
 * The ceiling, as a percentage of the referred customer's first-year revenue.
 *
 * This is the one business number in the file. Everything else is derived.
 */
export const REWARD_CAP_PERCENT = 10

/**
 * A plan's prices, in pence.
 *
 * Pence because money in a float is how a rate ends up at 9.999999% and a
 * test that reads `<= 0.1` disagrees with one that reads `< 0.1`. Every
 * comparison in this file is integer arithmetic.
 */
export interface PlanPrice {
  slug: string
  /** Product name, for display. Never used in the arithmetic. */
  name?: string
  monthlyPence: number
  annualPence: number
}

/** Bring `every` paying customers of one plan, get `months` free. Repeats. */
export interface Rate {
  every: number
  months: number
}

/**
 * The most generous reward that still fits under the cap.
 *
 * Two shapes come out of this, and which one depends on whether a single
 * referral can pay for a whole month:
 *
 *   MONTHS PER REFERRAL — the referrer's month is cheap relative to what the
 *   new customer pays, so each referral earns one or more whole months.
 *
 *   REFERRALS PER MONTH — the referrer's month costs more than 10% of one
 *   referral, so several are needed. The rate is divided rather than the
 *   reward being cut into fractions: "a month for every four" is a sentence
 *   a coach can repeat; "a quarter of a month" is not a sentence anyone
 *   should have to read on a progress bar.
 */
export function rateFor(referrer: PlanPrice, referred: PlanPrice): Rate {
  // A free plan has no month to give away and no revenue to measure against.
  // Callers are supposed to have filtered these out already (a referral only
  // qualifies on payment); this is the backstop that keeps a zero out of a
  // denominator rather than trusting every caller forever.
  if (referrer.monthlyPence <= 0 || referred.annualPence <= 0) {
    return { every: 1, months: 0 }
  }

  // How many whole months 10% of their first year will buy.
  const months = Math.floor(
    (referred.annualPence * REWARD_CAP_PERCENT) / (100 * referrer.monthlyPence),
  )
  if (months >= 1) return { every: 1, months }

  // Not even one. How many referrals does it take to afford one month?
  const every = Math.ceil(
    (referrer.monthlyPence * 100) / (REWARD_CAP_PERCENT * referred.annualPence),
  )
  return { every, months: 1 }
}

/**
 * What this rate actually costs, as a fraction of first-year revenue.
 *
 * Exported because it is what the guard tests assert on, and because a number
 * that only exists inside a test is a number nobody can check against the
 * admin screen later.
 */
export function costShare(referrer: PlanPrice, referred: PlanPrice, rate: Rate = rateFor(referrer, referred)): number {
  if (referred.annualPence <= 0 || rate.every <= 0) return 0
  return (rate.months * referrer.monthlyPence) / (rate.every * referred.annualPence)
}

export interface OwedReward {
  /** The plan the referrer was on. Locked at qualification, never re-read. */
  referrerPlan: string
  /** The plan the new customer bought. Also locked at qualification. */
  referredPlan: string
  /**
   * Which award this is on this pairing, 1-based.
   *
   * Stored in the ledger's `cycle` column. Together with the two plan slugs
   * it is what makes the insert idempotent: recomputing after a webhook retry
   * produces the same award numbers and the unique key rejects the duplicate.
   */
  cycle: number
  /**
   * The `every` in force when this was earned.
   *
   * Recorded on the row rather than looked up later, for the same reason the
   * collaboration programme copies its commission rate onto each statement line:
   * changing a price must never restate history. A coach who earned a month
   * for every two referrals keeps having earned it, even after a price rise
   * moves the live rate to one for every three.
   */
  every: number
  months: number
}

/**
 * Every award earned for `qualified` paid referrals on one pairing.
 *
 * Returned as a list rather than a total because the ledger stores one row
 * per award — that is what lets a specific reward be revoked when the
 * referral behind it refunds, without recomputing everything around it.
 */
export function owedRewards(
  referrerPlan: string,
  referredPlan: string,
  rate: Rate,
  qualified: number,
): OwedReward[] {
  if (rate.months <= 0 || rate.every <= 0) return []
  const awards = Math.floor(Math.max(0, qualified) / rate.every)
  return Array.from({ length: awards }, (_, i) => ({
    referrerPlan,
    referredPlan,
    cycle: i + 1,
    every: rate.every,
    months: rate.months,
  }))
}

/** Total free months for `qualified` referrals at this rate. */
export function monthsEarned(rate: Rate, qualified: number): number {
  if (rate.every <= 0) return 0
  return Math.floor(Math.max(0, qualified) / rate.every) * rate.months
}

export interface LadderProgress {
  referrerPlan: string
  referredPlan: string
  qualified: number
  rate: Rate
  monthsEarned: number
  /**
   * The next award: how many more are needed, and what it pays.
   *
   * Never null. The old three-rung ladder could run out of rungs mid-pass and
   * had to render "nothing more to earn", which is a strange thing to tell
   * somebody in the middle of a programme. A flat rate always has a next one.
   */
  next: { inMore: number; months: number }
}

/**
 * Everything the progress UI needs, from the same function the payouts come
 * from. A progress bar that disagrees with the ledger is a support ticket
 * that takes an hour to unpick.
 */
export function ladderProgress(
  referrer: PlanPrice,
  referred: PlanPrice,
  qualified: number,
): LadderProgress {
  const safe = Math.max(0, qualified)
  const rate = rateFor(referrer, referred)
  return {
    referrerPlan: referrer.slug,
    referredPlan: referred.slug,
    qualified: safe,
    rate,
    monthsEarned: monthsEarned(rate, safe),
    // Landing exactly on an award resets the countdown to a full `every`
    // rather than reading zero — "0 more to go" sitting next to an award
    // already paid is the kind of off-by-one a coach screenshots and sends
    // you.
    next: {
      inMore: rate.every - (safe % rate.every),
      months: rate.months,
    },
  }
}

/**
 * Qualified referral counts, keyed `referrerPlan|referredPlan`.
 *
 * A pipe, because plan slugs are `[a-z0-9-]` and cannot contain one. This was
 * briefly a NUL byte, which worked and made the whole file read as BINARY to
 * grep, git diff and every review tool — a separator nobody can see is not
 * cleverness, it is a file nobody can search.
 */
export type PairCounts = Map<string, number>

export const pairKey = (referrerPlan: string, referredPlan: string): string =>
  `${referrerPlan}|${referredPlan}`

export const splitPairKey = (key: string): [string, string] => {
  const [referrer, referred] = key.split('|')
  return [referrer ?? '', referred ?? '']
}

/**
 * Everything owed across every pairing this referrer has.
 *
 * `prices` is looked up per slug rather than passed as a fixed table, because
 * a referrer can hold rows on plans they have since left and those still have
 * to price correctly. A slug with no price left in the book earns nothing
 * rather than throwing — a retired plan must not be able to take down the
 * webhook that pays everybody else.
 */
export function allOwedRewards(
  counts: PairCounts,
  prices: (slug: string) => PlanPrice | undefined,
): OwedReward[] {
  const out: OwedReward[] = []
  for (const [key, qualified] of counts) {
    const [referrerPlan, referredPlan] = splitPairKey(key)
    const referrer = prices(referrerPlan)
    const referred = prices(referredPlan)
    if (!referrer || !referred) continue
    out.push(...owedRewards(referrerPlan, referredPlan, rateFor(referrer, referred), qualified))
  }
  // Stable order so a recompute produces the same list twice — the ledger
  // diff below it compares by key, but a deterministic order makes the
  // failure messages readable when it doesn't.
  return out.sort(
    (a, b) =>
      a.referrerPlan.localeCompare(b.referrerPlan) ||
      a.referredPlan.localeCompare(b.referredPlan) ||
      a.cycle - b.cycle,
  )
}

/** Total free months across every pairing. */
export function totalMonthsEarned(
  counts: PairCounts,
  prices: (slug: string) => PlanPrice | undefined,
): number {
  return allOwedRewards(counts, prices).reduce((sum, r) => sum + r.months, 0)
}
