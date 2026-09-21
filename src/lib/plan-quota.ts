// "You have used your five." One place, so every wall says it the same way.
//
// Four things are now counted per plan — boards, drill sheets, books and
// sessions — and they are counted the same way every time: how many live rows
// does this coach have, what does their plan allow, and if that is spent,
// refuse with a 402 carrying a sentence the UI can show unedited.
//
// Written once rather than four times because the failure mode of copying it
// is silent and expensive in both directions. Miss the check on one route and
// that limit does not exist; count archived rows on another and a coach who
// tidied up is told they are full when they are not.
//
// 402, never 403. The coach is not forbidden, they are un-upgraded — and that
// distinction is the whole reason one frontend handler can answer every one of
// these walls with a price instead of an apology.

import { db } from '../config/database.js'
import { limitsFor, type PlanLimits } from './capabilities.js'
import { getEntitlements } from './entitlements.js'

/** The countable things. Each maps to one limit and one table. */
export type Quota = 'boards' | 'drillSheets' | 'books' | 'sessions'

export interface QuotaState {
  /** null = unlimited. */
  limit: number | null
  used: number
  remaining: number | null
  /** Is there room for one more? */
  allowed: boolean
}

/**
 * How each quota counts.
 *
 * All four tables hard-delete, so a plain count is right and "delete one to
 * make room" — the first thing anyone tries — actually works. If any of these
 * ever gains a soft-delete column, its counter must exclude it here, or a
 * coach who tidied up will be told they are full when they are not.
 */
const COUNTERS: Record<Quota, (userId: number) => Promise<number>> = {
  boards: (userId) => db.canvasBoard.count({ where: { userId } }),
  drillSheets: (userId) => db.drillSheet.count({ where: { userId } }),
  // ---- TEMPORARY: remove once `prisma generate` has run against migration 28
  books: (userId) =>
    (db as unknown as { ebook: { count(a: unknown): Promise<number> } })
      .ebook.count({ where: { authorId: userId } }),
  sessions: (userId) => db.trainingSession.count({ where: { userId } }),
}

/** What a coach is told when each runs out. */
const MESSAGES: Record<Quota, (limit: number) => string> = {
  boards: (n) =>
    `Your plan covers ${n} saved boards. Upgrade for unlimited boards, or delete one to make room.`,
  drillSheets: (n) =>
    `Your plan covers ${n} drill sheets. Upgrade for unlimited sheets, or delete one to make room.`,
  books: (n) =>
    n === 1
      ? 'Your plan covers one book. Upgrade to write more — and to publish them.'
      : `Your plan covers ${n} books. Upgrade to write more.`,
  sessions: (n) =>
    `Your plan covers ${n} saved ${n === 1 ? 'session' : 'sessions'}. Upgrade for the full season planner.`,
}

/** Where each quota reads its number from. */
const LIMIT_KEY: Record<Quota, keyof PlanLimits> = {
  boards: 'boards',
  drillSheets: 'drillSheets',
  books: 'books',
  sessions: 'sessions',
}

/** Where this coach stands on one quota, right now. */
export async function quotaState(userId: number, quota: Quota): Promise<QuotaState> {
  const limit = limitsFor(await getEntitlements(userId))[LIMIT_KEY[quota]]
  if (limit === null) return { limit: null, used: 0, remaining: null, allowed: true }

  const used = await COUNTERS[quota](userId)
  return {
    limit,
    used,
    // Never negative. A limit lowered under an existing account (or a race
    // between two creates) would otherwise render "-2 remaining".
    remaining: Math.max(0, limit - used),
    allowed: used < limit,
  }
}

/** A 402 the frontend turns into an upgrade prompt. */
export function quotaError(quota: Quota, limit: number): Error & { statusCode: number } {
  const e = new Error(MESSAGES[quota](limit)) as Error & { statusCode: number }
  e.statusCode = 402
  return e
}

/**
 * Refuse if this coach has no room left. Call immediately BEFORE the create.
 *
 * Throws rather than returning a boolean so a caller cannot forget to check
 * the answer — the one mistake that would leave a limit silently unenforced
 * while looking, at the call site, exactly like a limit that works.
 */
export async function assertQuota(userId: number, quota: Quota): Promise<void> {
  const state = await quotaState(userId, quota)
  if (!state.allowed) throw quotaError(quota, state.limit!)
}

/** Every quota at once, for the entitlements payload the frontend caches. */
export async function allQuotas(userId: number): Promise<Record<Quota, QuotaState>> {
  const keys: Quota[] = ['boards', 'drillSheets', 'books', 'sessions']
  const states = await Promise.all(keys.map((k) => quotaState(userId, k)))
  return Object.fromEntries(keys.map((k, i) => [k, states[i]])) as Record<Quota, QuotaState>
}
