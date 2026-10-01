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
import { freeUsed, releaseFreeSlot, reserveFreeSlot } from './free-trial.js'

/** The countable things. Each maps to one limit and one table. */
export type Quota = 'boards' | 'drillSheets' | 'books' | 'sessions' | 'seasons'

export interface QuotaState {
  /** null = unlimited. */
  limit: number | null
  used: number
  remaining: number | null
  /** Is there room for one more? */
  allowed: boolean
  /** Counted by creation (the free trial) rather than by rows kept. */
  lifetime: boolean
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
  // Matches are fixtures, not training content, and never count (see the
  // sessions route, which lets a coach at the limit still add a match).
  sessions: (userId) => db.trainingSession.count({ where: { userId, isMatch: false } }),
  seasons: (userId) => db.seasonPlan.count({ where: { userId } }),
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
  seasons: (n) => `Your plan covers ${n} season ${n === 1 ? 'plan' : 'plans'}. Upgrade for more.`,
}

/** The free trial's walls: counted by creation, so they never say "delete one". */
const LIFETIME_MESSAGES: Record<Quota, (n: number) => string> = {
  boards: (n) => `Your free trial includes ${n} boards in total — deleted boards still count. Choose a plan for unlimited boards.`,
  drillSheets: (n) => `Your free trial includes ${n} drill sheets in total — deleted sheets still count. Choose a plan for unlimited sheets.`,
  sessions: (n) => `Your free trial includes ${n} sessions in total — deleted sessions still count. Choose a plan for the full season planner.`,
  seasons: (n) => `Your free trial includes ${n === 1 ? 'one season plan' : `${n} season plans`} in total — a deleted season still counts. Choose a plan for more.`,
  books: () => 'Your free trial includes one book, and publishing needs a paid plan.',
}

/** Where each quota reads its number from. */
const LIMIT_KEY: Record<Quota, keyof PlanLimits> = {
  boards: 'boards',
  drillSheets: 'drillSheets',
  books: 'books',
  sessions: 'sessions',
  seasons: 'seasons',
}

/** Where this coach stands on one quota, right now. */
export async function quotaState(userId: number, quota: Quota): Promise<QuotaState> {
  const ent = await getEntitlements(userId)
  const limit = limitsFor(ent)[LIMIT_KEY[quota]]
  const lifetime = ent.plan?.slug === 'free'
  if (limit === null) return { limit: null, used: 0, remaining: null, allowed: true, lifetime }

  const used = lifetime ? await freeUsed(userId, quota) : await COUNTERS[quota](userId)
  return {
    limit,
    used,
    // Never negative: an account backfilled over a limit would otherwise
    // render "-2 remaining".
    remaining: Math.max(0, limit - used),
    allowed: used < limit,
    lifetime,
  }
}

export type QuotaError = Error & { statusCode: number; code: 'QUOTA_REACHED'; quota: Quota; limit: number; lifetime: boolean }

/** A 402 the frontend turns into an upgrade prompt (and, on the trial, a translated line). */
export function quotaError(quota: Quota, limit: number, lifetime = false): QuotaError {
  const e = new Error((lifetime ? LIFETIME_MESSAGES : MESSAGES)[quota](limit)) as QuotaError
  e.statusCode = 402
  e.code = 'QUOTA_REACHED'
  e.quota = quota
  e.limit = limit
  e.lifetime = lifetime
  return e
}

/**
 * Take room for one more, immediately BEFORE the create. Throws the 402 when
 * there is none. Returns `release`, to call if the create then fails — on the
 * free trial the slot was already spent, and a coach must never be charged a
 * board they did not get. On paid plans release is a no-op (nothing was held).
 */
export async function claimQuota(userId: number, quota: Quota, count = 1): Promise<() => Promise<void>> {
  const ent = await getEntitlements(userId)
  const limit = limitsFor(ent)[LIMIT_KEY[quota]]
  const noop = async () => {}
  if (limit === null || count <= 0) return noop
  if (ent.plan?.slug === 'free') {
    if (!(await reserveFreeSlot(userId, quota, limit, count))) throw quotaError(quota, limit, true)
    return () => releaseFreeSlot(userId, quota, count)
  }
  if ((await COUNTERS[quota](userId)) + count > limit) throw quotaError(quota, limit, false)
  return noop
}

/**
 * Claim, create, and give the slot back if the create throws. The one way
 * create routes take a quota, so none can forget the release.
 */
export async function withQuota<T>(userId: number, quota: Quota, create: () => Promise<T>, count = 1): Promise<T> {
  const release = await claimQuota(userId, quota, count)
  try {
    return await create()
  } catch (err) {
    await release().catch(() => {})
    throw err
  }
}

/** Refuse if there is no room. Prefer `claimQuota` at create sites. */
export async function assertQuota(userId: number, quota: Quota): Promise<void> {
  await claimQuota(userId, quota)
}

/** Every quota at once, for the entitlements payload the frontend caches. */
export async function allQuotas(userId: number): Promise<Record<Quota, QuotaState>> {
  const keys: Quota[] = ['boards', 'drillSheets', 'books', 'sessions', 'seasons']
  const states = await Promise.all(keys.map((k) => quotaState(userId, k)))
  return Object.fromEntries(keys.map((k, i) => [k, states[i]])) as Record<Quota, QuotaState>
}
