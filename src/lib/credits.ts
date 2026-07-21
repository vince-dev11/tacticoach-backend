// AI credit accounting.
//
// Model: each plan grants a MONTHLY allowance of AI generations (the numbers
// the pricing page has always advertised). Usage is metered by counting
// ai_usage rows in the current calendar month, so there is no refill job to
// run or forget. Purchased top-ups live in users.bonus_credits, never expire,
// and are only consumed once the month's allowance is gone.
//
// Trial is the exception: it grants a TOTAL of 3 credits for the whole trial
// (not per month), matching "3 AI generation credits" on the pricing page.

import { db } from '../config/database.js'
import { getEntitlements } from './entitlements.js'

export type AiKind = 'layout' | 'animation' | 'reel'

/** Monthly allowance per plan slug (trial = total for the trial period). */
const PLAN_ALLOWANCE: Record<string, number> = {
  pro: 0, // Pro is the no-AI tier
  'pro-ai': 5,
  club: 40,
}
const TRIAL_ALLOWANCE = 3

export interface CreditState {
  allowance: number
  used: number
  bonus: number
  remaining: number
  /** Whether the allowance is a monthly grant (false for trial's one-off 3). */
  monthly: boolean
}

function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

export async function getCreditState(userId: number): Promise<CreditState> {
  const [ent, user] = await Promise.all([
    getEntitlements(userId),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { bonusCredits: true } }),
  ])

  const onTrial = ent.subscriptionStatus === 'trial'
  const allowance = onTrial
    ? TRIAL_ALLOWANCE
    : ent.editorAccess && ent.plan
      ? (PLAN_ALLOWANCE[ent.plan.slug] ?? 0)
      : 0

  // Trial counts ALL usage (one-off grant); paid plans count this month only.
  const used = await db.aiUsage.count({
    where: { userId, ...(onTrial ? {} : { createdAt: { gte: monthStart() } }) },
  })

  const bonus = user.bonusCredits
  return {
    allowance,
    used,
    bonus,
    remaining: Math.max(0, allowance - used) + bonus,
    monthly: !onTrial,
  }
}

/**
 * Spend one credit AFTER a successful generation. Prefers the monthly
 * allowance; falls back to bonus credits. Returns the new remaining balance.
 * (Call `getCreditState` first to gate the request — this only records.)
 */
export async function recordCreditSpend(userId: number, kind: AiKind): Promise<number> {
  const state = await getCreditState(userId)
  const fromAllowance = state.allowance - state.used > 0
  await db.$transaction([
    db.aiUsage.create({ data: { userId, kind } }),
    ...(fromAllowance
      ? []
      : [db.user.update({ where: { id: userId }, data: { bonusCredits: { decrement: 1 } } })]),
  ])
  return Math.max(0, state.remaining - 1)
}

/** Grant purchased top-up credits (Stripe webhook will call this later). */
export async function grantBonusCredits(userId: number, amount: number): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { bonusCredits: { increment: amount } } })
}
