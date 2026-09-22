// Recording who accepted which agreement.
//
// One place, so every agreement is recorded the same way and none of them
// grows its own slightly different notion of what "signed" means.

import { db } from '../config/database.js'

export type AgreementKind = 'referral' | 'collaboration'

// ---- TEMPORARY: remove once `prisma generate` has run against migration 26 --
// The generated client has no `agreementAcceptance` delegate until then.
// Narrow on purpose, so it cannot mask a mistake elsewhere.
interface AcceptanceRow {
  id: number
  userId: number
  kind: AgreementKind
  version: string
  signerName: string | null
  signature: string | null
  signedAt: Date
  ip: string | null
}
const acceptanceDb = () =>
  (db as unknown as {
    agreementAcceptance: {
      findFirst(args?: unknown): Promise<AcceptanceRow | null>
      findMany?(args?: unknown): Promise<AcceptanceRow[]>
      count?(args?: unknown): Promise<number>
      groupBy?(args?: unknown): Promise<{ version: string; _count: { _all: number } }[]>
      upsert(args: unknown): Promise<AcceptanceRow>
    }
  }).agreementAcceptance

/**
 * A signature, as it arrives from the browser.
 *
 * Validated here rather than trusted, because it is an unauthenticated-shaped
 * blob that gets stored and later rendered into a PDF: the two things that
 * matter are that it really is a PNG, and that it is small.
 */
export const MAX_SIGNATURE_BYTES = 200 * 1024

export function signatureProblem(dataUrl: string): string | null {
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    return 'The signature must be a PNG image.'
  }
  // base64 is 4 characters per 3 bytes; close enough to reject the absurd
  // without decoding the whole thing to measure it.
  const bytes = Math.floor((dataUrl.length - 'data:image/png;base64,'.length) * 3 / 4)
  if (bytes > MAX_SIGNATURE_BYTES) return 'That signature image is too large.'
  // A handful of bytes is a blank canvas, not a signature.
  if (bytes < 256) return 'Please sign before continuing.'
  return null
}

/** What a PDF needs to reproduce a signed agreement. */
export interface SignedRecord {
  kind: AgreementKind
  version: string
  signerName: string | null
  signature: string | null
  signedAt: Date
  ip: string | null
}

export async function getAcceptance(
  userId: number,
  kind: AgreementKind,
  version?: string,
): Promise<SignedRecord | null> {
  return acceptanceDb().findFirst({
    where: { userId, kind, ...(version ? { version } : {}) },
    orderBy: { signedAt: 'desc' },
    select: {
      kind: true, version: true, signerName: true,
      signature: true, signedAt: true, ip: true,
    },
  }) as Promise<SignedRecord | null>
}

/**
 * Has this user accepted the CURRENT version of an agreement?
 *
 * Deliberately version-specific. Someone who signed 1.0 has not agreed to 1.1,
 * and treating them as though they had is the thing the version column exists
 * to prevent. Callers that want "have they ever signed anything" should say so
 * explicitly rather than reaching for this.
 */
export async function hasAccepted(
  userId: number,
  kind: AgreementKind,
  version: string,
): Promise<Date | null> {
  const row = await acceptanceDb().findFirst({
    where: { userId, kind, version },
    select: { signedAt: true },
  })
  return row?.signedAt ?? null
}

/**
 * Record an acceptance.
 *
 * Idempotent by (user, kind, version): double-clicking "I accept" is not two
 * agreements, and the FIRST signature is the one kept — a repeat post must not
 * quietly move the date somebody signed on.
 */
export async function recordAcceptance(
  userId: number,
  kind: AgreementKind,
  version: string,
  ip: string | null,
  signer: { name: string; signature: string },
): Promise<Date> {
  const row = await acceptanceDb().upsert({
    where: { userId_kind_version: { userId, kind, version } },
    // Empty on purpose. A repeat post must not overwrite the name, the
    // signature or — above all — the date somebody signed on. The first
    // signature is the one that stands.
    update: {},
    create: {
      userId,
      kind,
      version,
      ip,
      signerName: signer.name.trim().slice(0, 160),
      signature: signer.signature,
    },
  })
  return row.signedAt
}

/**
 * The latest acceptance of one agreement for a whole set of users at once.
 *
 * For the admin overview, which needs the state of every coach on a page.
 * Doing it with `getAcceptance` per row is N+1 queries to draw one table, and
 * that table is the thing somebody refreshes while chasing signatures.
 *
 * Returns the LATEST row per user — a coach who signed 1.0 and then 2.0 shows
 * as 2.0 — so a caller can tell "never signed" from "signed something older"
 * by comparing the version, which is exactly the distinction the gate makes.
 * The signature image is never selected: this feeds a table of dates, and a
 * few hundred kilobytes of base64 per row to draw one is waste.
 */
export async function latestAcceptances(
  userIds: number[],
  kind: AgreementKind,
): Promise<Map<number, { version: string; signerName: string | null; signedAt: Date }>> {
  const out = new Map<number, { version: string; signerName: string | null; signedAt: Date }>()
  if (userIds.length === 0) return out

  const rows = (await acceptanceDb().findMany?.({
    where: { userId: { in: userIds }, kind },
    // Oldest first, so the newest write wins as we walk it. Sorting in the
    // database rather than in JS because `signedAt` is set by the database and
    // two rows can share a millisecond.
    orderBy: [{ signedAt: 'asc' }, { id: 'asc' }],
    select: { userId: true, version: true, signerName: true, signedAt: true },
  })) as { userId: number; version: string; signerName: string | null; signedAt: Date }[] | undefined

  for (const row of rows ?? []) {
    out.set(row.userId, {
      version: row.version,
      signerName: row.signerName,
      signedAt: row.signedAt,
    })
  }
  return out
}
