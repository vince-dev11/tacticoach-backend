// AI credit accounting.
//
// Model: each plan grants a MONTHLY allowance of AI generations (the numbers
// the pricing page has always advertised). Usage is metered by counting
// ai_usage rows in the current calendar month, so there is no refill job to
// run or forget. Purchased top-ups live in users.bonus_credits, never expire,
// and are only consumed once the month's allowance is gone.
//
// Trial is the exception: it grants a TOTAL grant for the whole trial period
// (not per month), matching the number shown on the pricing page.
//
// SIZING (reviewed July 2026): a generation costs roughly 0.1p on the DSL path
// and up to ~1.4p on the fallback path — an order of magnitude less than the
// payment-processing fee on the same subscription. Allowances are therefore set
// for COACH BEHAVIOUR (a coach plans 2–3 sessions a week), not to protect cost.
// Generosity here drives activation, shared reels and word of mouth; scarcity
// would suppress exactly the usage the product needs.

import { db } from '../config/database.js'
import { getEntitlements } from './entitlements.js'

export type AiKind = 'layout' | 'animation' | 'reel'

/** Monthly allowance per plan slug (trial = total for the trial period). */
const PLAN_ALLOWANCE: Record<string, number> = {
  pro: 3, // a taste of the AI so every user has a reason to upgrade
  'pro-ai': 30, // ~1 generation per session for a coach working twice a week
  club: 200, // 10 seats → 20 per coach per month
}
const TRIAL_ALLOWANCE = 10

/**
 * The company owner's account has no allowance at all — not a very large one.
 * It used to be given 100,000 credits, which is the same thing until it isn't:
 * the balance was still counted, still decremented, and would still one day
 * refuse to generate. An internal account that can run out is a trap, so it now
 * short-circuits the accounting entirely.
 */
const UNLIMITED_PLANS = new Set(['owner'])

export interface CreditState {
  allowance: number
  used: number
  bonus: number
  remaining: number
  /** Whether the allowance is a monthly grant (false for trial's one-off 3). */
  monthly: boolean
  /** No limit applies — don't meter, don't gate, don't show a balance. */
  unlimited: boolean
}

function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

/**
 * JSON has no way to write Infinity — `JSON.stringify` turns it into `null`
 * silently. An unlimited balance therefore crosses the wire as an explicit
 * `null`, which the editor reads as "don't show a number", rather than as an
 * accident of serialisation.
 */
export function remainingForWire(remaining: number): number | null {
  return Number.isFinite(remaining) ? remaining : null
}

export function creditsForWire(state: CreditState): Omit<CreditState, 'remaining'> & {
  remaining: number | null
} {
  return { ...state, remaining: remainingForWire(state.remaining) }
}

export async function getCreditState(userId: number): Promise<CreditState> {
  const ent = await getEntitlements(userId)

  // Unlimited accounts never touch the usage table — there is nothing to count.
  if (ent.plan && UNLIMITED_PLANS.has(ent.plan.slug)) {
    return { allowance: 0, used: 0, bonus: 0, remaining: Infinity, monthly: false, unlimited: true }
  }

  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { bonusCredits: true },
  })

  const onTrial = ent.subscriptionStatus === 'trial'
  const allowance = onTrial
    ? TRIAL_ALLOWANCE
    : ent.editorAccess && ent.plan
      ? (PLAN_ALLOWANCE[ent.plan.slug] ?? 0)
      : 0

  // Trial counts ALL usage (one-off grant); paid plans count this month only.
  // Free retries are recorded for analytics but never consume the allowance.
  const used = await db.aiUsage.count({
    where: { userId, freeRetry: false, ...(onTrial ? {} : { createdAt: { gte: monthStart() } }) },
  })

  const bonus = user.bonusCredits
  return {
    allowance,
    used,
    bonus,
    remaining: Math.max(0, allowance - used) + bonus,
    monthly: !onTrial,
    unlimited: false,
  }
}

/**
 * Spend one credit AFTER a successful generation. Prefers the monthly
 * allowance; falls back to bonus credits. Returns the new remaining balance.
 * (Call `getCreditState` first to gate the request — this only records.)
 */
export async function recordCreditSpend(userId: number, kind: AiKind, prompt = ''): Promise<number> {
  const state = await getCreditState(userId)
  // An unlimited account is still logged — the usage data is worth having — but
  // nothing is ever deducted, and the balance it reports back stays unlimited.
  if (state.unlimited) {
    await db.aiUsage.create({
      data: { userId, kind, ...(prompt ? { promptHash: promptFingerprint(prompt) } : {}) },
    })
    return Infinity
  }
  const fromAllowance = state.allowance - state.used > 0
  await db.$transaction([
    db.aiUsage.create({
      data: { userId, kind, ...(prompt ? { promptHash: promptFingerprint(prompt) } : {}) },
    }),
    ...(fromAllowance
      ? []
      : [db.user.update({ where: { id: userId }, data: { bonusCredits: { decrement: 1 } } })]),
  ])
  return Math.max(0, state.remaining - 1)
}

/**
 * FREE RETRY — a coach never pays twice for the same idea.
 *
 * If the coach re-runs the SAME prompt shortly after a generation, the second
 * attempt is on us: charging for a result they did not want reads as a penalty
 * for our miss. One free retry per generation; changing the prompt is a new
 * idea and costs a credit again.
 *
 * It also keeps our accuracy telemetry honest — regenerate-rate is the quality
 * proxy, and a credit charge would suppress exactly the signal we need.
 */
export const FREE_RETRY_WINDOW_MS = 15 * 60 * 1000

export async function isFreeRetry(userId: number, kind: AiKind, prompt: string): Promise<boolean> {
  const fingerprint = promptFingerprint(prompt)
  const since = new Date(Date.now() - FREE_RETRY_WINDOW_MS)
  const previous = (await db.aiUsage.findFirst({
    where: { userId, kind, createdAt: { gte: since }, promptHash: fingerprint },
    orderBy: { createdAt: 'desc' },
    // The generated Prisma client only learns `freeRetry` after the migration
    // + `prisma generate` run on a machine with network access, so the narrow
    // cast keeps this file compiling before and after that step.
  })) as { freeRetry?: boolean } | null
  // Free only when the previous attempt at this same idea was itself paid for
  // — two free retries in a row would be a loophole.
  return Boolean(previous && !previous.freeRetry)
}

/** Stable, privacy-friendly fingerprint of a prompt (not the prompt itself). */
export function promptFingerprint(prompt: string): string {
  const normalised = prompt.trim().toLowerCase().replace(/\s+/g, ' ')
  let h = 0
  for (let i = 0; i < normalised.length; i++) {
    h = (Math.imul(31, h) + normalised.charCodeAt(i)) | 0
  }
  return `p${(h >>> 0).toString(36)}`
}

/** Record a generation that cost the coach nothing. */
export async function recordFreeRetry(userId: number, kind: AiKind, prompt: string): Promise<void> {
  await db.aiUsage.create({
    data: { userId, kind, promptHash: promptFingerprint(prompt), freeRetry: true },
  })
}

/** Grant purchased top-up credits (Stripe webhook will call this later). */
export async function grantBonusCredits(userId: number, amount: number): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { bonusCredits: { increment: amount } } })
}
