// The Collaboration Programme's numbers, and nothing else.
//
// A leaf module ON PURPOSE. It imports nothing, so both of the two files that
// need these can import it without importing each other:
//
//   collaborations.service.ts  — pays the money
//   collaboration-agreement.ts — promises the money
//
// Those two used to import each other. It worked, because ES modules tolerate
// a cycle, and it was a trap: the agreement builds its text at module load
// from these constants, so whichever module happened to load first decided
// whether they were initialised yet. A cycle that works today and throws
// "cannot access before initialisation" after an unrelated import is reordered
// is not a risk worth carrying for one file's worth of constants.
//
// THIS FILE IS THE ONE PLACE THESE NUMBERS EXIST. The agreement interpolates
// them rather than repeating them, which is how the old partner agreement came
// to promise 20% while the system paid 15%.

/**
 * Commission is earned on each introduced customer's FIRST cleared payment
 * only — never on a renewal or a later instalment.
 *
 * This replaced a 12-month window. One payment per customer keeps the cost of
 * an introduction bounded and known the moment it happens, and it means a
 * collaborator is paid for the introduction, which is what they did — the
 * renewals are earned by the product. It also steers collaborators toward
 * annual plans, where the first payment is a whole year.
 *
 * Exported as a named constant so the agreement, the emails and the tests
 * all state the same rule from one place.
 */
export const COMMISSION_FIRST_PAYMENT_ONLY = true as const

/**
 * What a new collaborator earns, as FRACTIONS. 0.15 is 15%.
 *
 * Never percents: the admin route caps a rate at 1, so `15` meaning 15% is
 * refused rather than committing us to fifteen times the revenue.
 *
 * TWO RATES, because a club is a harder sale than a coach — a committee
 * decision over months rather than one person deciding in minutes. A single
 * rate already pays more for a club, since it is a percentage of a bigger
 * number; the extra five points is for the difficulty, not the size. Pay the
 * same for both and every collaborator rationally spends their effort on the
 * easy one.
 */
export const DEFAULT_COACH_RATE = 0.15
export const DEFAULT_CLUB_RATE = 0.2

/** Balance below which commission rolls over instead of being paid (£50). */
export const PAYOUT_THRESHOLD_PENCE = 5000

/**
 * Payouts run three times a year, on fixed calendar dates.
 *
 * Fixed rather than four months from each collaborator's own start date.
 * Rolling dates scatter payouts across every day of the year and make an admin
 * job that never finishes; these make it three afternoons. Months are 0-based,
 * as `Date` has them: 1 February, 1 June, 1 October.
 */
export const PAYOUT_MONTHS = [1, 5, 9] as const

/**
 * How many pieces of content a collaborator is asked for each payout period,
 * and how many of those should be video.
 *
 * This is an EXPECTATION, not a payment condition, and the distinction is
 * load-bearing:
 *
 *   * They earned the commission by introducing a paying customer. Holding it
 *     over an unrelated Instagram post is an argument we cannot win cheaply.
 *   * It would drift the relationship toward employment. Setting a required
 *     quantity of work, checking it, and paying conditionally on it is the
 *     shape of a job; commission-only, their channel, their words, their pace
 *     is clearly not one.
 *
 * So it is reviewed at each payout instead. Missed once: paid in full, and a
 * conversation. Missed twice running: the collaboration ends under the notice
 * the agreement already allows. They keep what they earned; they stop earning
 * more.
 *
 * At least one must be VIDEO because what TactiCoach produces is video —
 * animated boards, reel export. Four screenshots do not show the product; one
 * reel of a board actually moving does, and the export is a feature they
 * already have, so it costs them nothing extra.
 */
export const CONTENT_PER_CYCLE = 4
export const CONTENT_VIDEO_MINIMUM = 1

/** The next payout date on or after `from`. */
export function nextPayoutDate(from: Date = new Date()): Date {
  const year = from.getUTCFullYear()
  for (const month of PAYOUT_MONTHS) {
    const date = new Date(Date.UTC(year, month, 1))
    if (date >= from) return date
  }
  // Past the last one this year — the first of next year.
  return new Date(Date.UTC(year + 1, PAYOUT_MONTHS[0], 1))
}
