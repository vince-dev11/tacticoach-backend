// Turning an earned reward into actual free time on an account.
//
// There are two different things "a free month" can mean, depending on whether
// the coach is paying us at the time, and getting this wrong is the classic way
// a rewards programme ends up either giving nothing or giving twice:
//
//   Paying by card  → money off the next invoice (a Stripe customer balance
//                     credit). Their subscription keeps running untouched;
//                     Stripe draws the balance down on the next bill.
//   Not paying      → time on a comped subscription. Nothing to discount, so
//                     the reward has to be access itself.
//
// Either way the reward row is marked applied exactly once.

import { db } from '../../config/database.js'
import { stripe, stripeConfigured } from '../../config/stripe.js'
// TEMPORARY — see prisma-shim.ts.
import { referralRewardDb } from './prisma-shim.js'

/** Plan a comped account lands on when the coach has never subscribed. */
const DEFAULT_CREDIT_PLAN = 'pro'

function addMonths(from: Date, months: number): Date {
  const d = new Date(from)
  const targetMonth = d.getMonth() + months
  const day = d.getDate()
  d.setMonth(targetMonth)
  // JS rolls 31 Jan + 1 month into 3 March. Clamp back to the last day of the
  // intended month so a coach who joined on the 31st isn't quietly given two
  // extra days every time credit is applied.
  if (d.getDate() < day) d.setDate(0)
  return d
}

/**
 * Pay out every reward this coach has earned and not yet received.
 *
 * Idempotent by construction: a reward is selected only while `appliedAt` is
 * null, and it is stamped as part of the same step that grants the value.
 */
export async function applyPendingCredit(userId: number): Promise<number> {
  const pending = await referralRewardDb().findMany({
    where: { userId, appliedAt: null, revokedAt: null },
    orderBy: { grantedAt: 'asc' },
  })
  if (pending.length === 0) return 0

  const months = pending.reduce((sum, r) => sum + r.months, 0)
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      stripeCustomerId: true,
      subscription: {
        select: {
          id: true,
          status: true,
          expiresAt: true,
          planId: true,
          providerSubscriptionId: true,
          plan: { select: { monthlyPrice: true, currency: true } },
        },
      },
    },
  })
  if (!user) return 0

  const sub = user.subscription
  const onStripe = !!sub?.providerSubscriptionId && sub.status === 'active'

  if (onStripe && stripeConfigured() && user.stripeCustomerId) {
    const monthly = Number(sub!.plan.monthlyPrice ?? 0)
    const pence = Math.round(monthly * 100) * months
    if (pence > 0) {
      await stripe().customers.createBalanceTransaction(user.stripeCustomerId, {
        // Negative is a credit in Stripe's ledger: it reduces the next invoice.
        amount: -pence,
        currency: (sub!.plan.currency ?? 'GBP').toLowerCase(),
        description: `TactiCoach referral reward — ${months} free month${months === 1 ? '' : 's'}`,
      })
    }
  } else {
    // No card on file: the reward is access. Extend from whichever is later —
    // now, or the end of what they already have — so credit applied during a
    // live trial adds to it rather than swallowing the remainder.
    const plan =
      sub?.planId != null
        ? { id: sub.planId }
        : await db.membershipPlan.findUnique({ where: { slug: DEFAULT_CREDIT_PLAN }, select: { id: true } })
    if (!plan) return 0

    const now = new Date()
    const base = sub?.expiresAt && sub.expiresAt > now ? sub.expiresAt : now
    const expiresAt = addMonths(base, months)

    await db.userSubscription.upsert({
      where: { userId },
      update: { status: 'active', expiresAt, cancelledAt: null },
      create: {
        userId,
        planId: plan.id,
        status: 'active',
        expiresAt,
        paymentProvider: 'referral_credit',
      },
    })
  }

  await referralRewardDb().updateMany({
    where: { id: { in: pending.map((r) => r.id) } },
    data: { appliedAt: new Date() },
  })
  return months
}

export const _internals = { addMonths }
