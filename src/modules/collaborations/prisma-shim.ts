// ---- TEMPORARY: remove once `prisma generate` has run against migration 17 --
//
// The partner tables were renamed to `collaborators` and
// `collaborator_commissions`, and the single `commission_rate` became
// `coach_rate` + `club_rate`. Until the client is regenerated, the checked-in
// one still describes the old shape — it has no `db.collaborator` at all — so
// every field this module touches is a type error against a schema that is
// already correct.
//
// TYPE-level only. It changes nothing at runtime: the queries it forwards are
// the queries Prisma will run once the client catches up.
//
// TO REMOVE: run `npx prisma generate`, delete this file, and change the
// imports back to `db.collaborator` and `db.collaboratorCommission`. The row
// types below are exactly what the generated client will produce.
// tests/collaborations-shim.test.ts fails the moment the real client catches
// up, so this cannot be forgotten.

import { Prisma } from '@prisma/client'
import { db } from '../../config/database.js'

export type CollaboratorStatus = 'invited' | 'active' | 'suspended' | 'ended'

export interface CollaboratorRow {
  id: number
  userId: number
  status: CollaboratorStatus
  /** Fractions, not percents: 0.15 is 15%. */
  coachRate: unknown
  clubRate: unknown
  companyName: string | null
  agreementSignedAt: Date | null
  agreementVersion: string | null
  agreementIp: string | null
  startedAt: Date
  endedAt: Date | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CommissionRow {
  id: number
  collaboratorId: number
  customerId: number
  providerInvoiceId: string
  netAmount: number
  /** The rate in force when this line was written. Never re-read live. */
  rate: unknown
  commissionAmount: number
  currency: string
  reversedAt: Date | null
  paidOutAt: Date | null
  createdAt: Date
}

type Args = Record<string, unknown>

interface CollaboratorDelegate {
  findUnique(args: Args): Promise<CollaboratorRow | null>
  findUniqueOrThrow(args: Args): Promise<CollaboratorRow>
  findMany(args?: Args): Promise<
    (CollaboratorRow & {
      user?: { id: number; name: string; surname: string | null; email: string; referralCode: string | null }
      commissions?: { commissionAmount: number; reversedAt: Date | null; paidOutAt: Date | null }[]
    })[]
  >
  upsert(args: Args): Promise<CollaboratorRow>
  update(args: Args): Promise<CollaboratorRow>
  updateMany(args: Args): Promise<{ count: number }>
}

interface CommissionDelegate {
  findMany(args?: Args): Promise<(CommissionRow & { customer: { name: string } })[]>
  create(args: Args): Promise<CommissionRow>
  updateMany(args: Args): Promise<{ count: number }>
}

/**
 * Whether the generated client has caught up with the schema.
 *
 * Read from `Prisma.ModelName` — a value the GENERATOR writes — rather than
 * from the `db` instance. Under test `db` is a deep mock that conjures any
 * property you ask for, so `!!db.collaborator` is true whether or not the
 * client knows the model, and the reminder below would fire on day one and be
 * disabled by whoever met it. This reads something no mock replaces.
 */
export function clientHasCollaborators(): boolean {
  return 'Collaborator' in (Prisma.ModelName as Record<string, unknown>)
}

export const collaboratorDb = (): CollaboratorDelegate =>
  (db as unknown as Record<string, unknown>).collaborator as CollaboratorDelegate

export const commissionDb = (): CommissionDelegate =>
  (db as unknown as Record<string, unknown>).collaboratorCommission as CommissionDelegate
