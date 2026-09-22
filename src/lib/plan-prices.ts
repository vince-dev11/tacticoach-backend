// Plan prices, in pence, read from the plans table.
//
// The referral programme computes its rates from prices (see
// referral-ladder.ts), so it needs the real ones — not a copy kept in step by
// hand. `membership_plans` is what Stripe charges against, so that is the
// authority here too.
//
// Read from the DATABASE rather than imported from prisma/plans.ts, even
// though plans.ts is where the numbers are written. plans.ts is the seed; the
// table is what is actually being billed. If someone edits a price in the
// admin screen and not in the seed file, the reward has to follow the money.

import { db } from '../config/database.js'
import type { PlanPrice } from './referral-ladder.js'

/**
 * A Prisma `Decimal` (or a string, or null) as whole pence.
 *
 * Via string, not `Number(decimal)`: Decimal's own valueOf is fine today, but
 * money that passes through a float on its way to a comparison is how a rate
 * ends up at 9.999999% and two tests disagree about whether that is under ten.
 */
export function toPence(value: unknown): number {
  if (value == null) return 0
  const n = Number(String(value))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export type PriceBook = Map<string, PlanPrice>

/**
 * Every plan we have a price for, keyed by slug.
 *
 * Inactive plans are included on purpose. A referrer can hold rewards earned
 * while on a plan we have since retired, and a recompute that could not price
 * those rows would try to revoke them.
 */
export async function loadPriceBook(): Promise<PriceBook> {
  const plans = await db.membershipPlan.findMany({
    select: { slug: true, name: true, monthlyPrice: true, annualPrice: true },
  })
  const book: PriceBook = new Map()
  for (const plan of plans) {
    book.set(plan.slug, {
      slug: plan.slug,
      // The product name, carried alongside the price so the rate card can be
      // rendered without the client keeping its own slug→name table. Plan
      // names are product names and are not translated, which is exactly why
      // they are safe to send rather than key off.
      name: plan.name,
      monthlyPence: toPence(plan.monthlyPrice),
      annualPence: toPence(plan.annualPrice),
    })
  }
  return book
}

/** A lookup function over a book, in the shape referral-ladder.ts expects. */
export const lookup =
  (book: PriceBook) =>
  (slug: string): PlanPrice | undefined =>
    book.get(slug)
