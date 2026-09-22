// ---- TEMPORARY: remove once `prisma generate` has run against migration 17 --
//
// The referral tables moved from two-value enums (`referrer_tier`, `kind`) to
// plan slugs, and gained the three payment-tracking columns the monthly bar
// needs. Until the client is regenerated, the checked-in one still describes
// the old shape, so every field this module touches is a type error against a
// schema that is already correct.
//
// This is a TYPE-level shim only. It changes nothing at runtime: the queries
// it forwards are the queries Prisma will run once the client catches up. It
// differs from the ebooks shim deliberately — there the delegate was missing
// entirely and had to answer 503, here the delegate exists and only its field
// types are behind.
//
// TO REMOVE: run `npx prisma generate`, delete this file, and change the two
// imports in referrals.service.ts back to `db.referral` and
// `db.referralReward`. The row types below are exactly what the generated
// client will produce, so nothing else should need touching. There is a test
// (tests/referrals-shim.test.ts) that fails the moment the real client
// catches up, so this cannot be forgotten.

import { Prisma } from '@prisma/client'
import { db } from '../../config/database.js'

export type ReferralStatus = 'pending' | 'qualified' | 'reversed'

export interface ReferralRow {
  id: number
  referrerId: number
  referredUserId: number
  code: string
  status: ReferralStatus
  /** The plan the new customer bought. Locked at qualification. */
  referredPlan: string
  /** The plan the referrer was on. Also locked at qualification. */
  referrerPlan: string
  firstPaymentAt: Date | null
  firstInvoiceId: string | null
  secondPaymentAt: Date | null
  qualifiedAt: Date | null
  reversedAt: Date | null
  createdAt: Date
}

export interface ReferralRewardRow {
  id: number
  userId: number
  referrerPlan: string
  referredPlan: string
  cycle: number
  /** The rate in force when this was earned — see referral-ladder.ts. */
  every: number
  months: number
  grantedAt: Date
  appliedAt: Date | null
  revokedAt: Date | null
}

/** Query arguments, passed through untouched. */
type Args = Record<string, unknown>

interface ReferralDelegate {
  findUnique(args: Args): Promise<ReferralRow | null>
  findMany(args?: Args): Promise<(ReferralRow & { referred: { name: string } })[]>
  create(args: Args): Promise<ReferralRow>
  update(args: Args): Promise<ReferralRow>
  groupBy(args: Args): Promise<
    { referrerPlan: string; referredPlan: string; _count: { _all: number } }[]
  >
}

interface ReferralRewardDelegate {
  findMany(args?: Args): Promise<ReferralRewardRow[]>
  create(args: Args): Promise<ReferralRewardRow>
  update(args: Args): Promise<ReferralRewardRow>
  updateMany(args: Args): Promise<{ count: number }>
}

/**
 * Whether the generated client has caught up with the schema.
 *
 * Read by the test that deletes this file's reason to exist. A client that
 * knows about `referrerPlan` no longer needs any of the above.
 */
export function clientHasNewReferralFields(): boolean {
  // From `Prisma.ReferralScalarFieldEnum` — written by the GENERATOR — rather
  // than from the `db` instance, which under test is a deep mock that conjures
  // any property you ask for. A reminder that fires on day one is a reminder
  // somebody disables.
  return 'referrerPlan' in (Prisma.ReferralScalarFieldEnum as Record<string, unknown>)
}

export const referralDb = (): ReferralDelegate => db.referral as unknown as ReferralDelegate
export const referralRewardDb = (): ReferralRewardDelegate =>
  db.referralReward as unknown as ReferralRewardDelegate
