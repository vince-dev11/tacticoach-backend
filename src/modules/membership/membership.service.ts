import { db } from '../../config/database.js'
import { stripe } from '../../config/stripe.js'

/** Get or create the user's Stripe customer id. */
export async function ensureStripeCustomer(userId: number): Promise<string> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, surname: true, stripeCustomerId: true },
  })
  if (user.stripeCustomerId) return user.stripeCustomerId
  const customer = await stripe().customers.create({
    email: user.email,
    name: `${user.name} ${user.surname}`.trim(),
    metadata: { userId: String(user.id) },
  })
  await db.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } })
  return customer.id
}

/**
 * Activate (or replace) the user's subscription. Called from the Stripe
 * webhook after checkout completes and on renewal updates. Creates the user's
 * Club when the plan is the club plan, so seats can be invited immediately.
 */
export async function activateSubscription(params: {
  userId: number
  planId: number
  billingCycle: 'monthly' | 'annual'
  providerSubscriptionId: string
  expiresAt: Date | null
}): Promise<void> {
  const { userId, planId, billingCycle, providerSubscriptionId, expiresAt } = params
  await db.userSubscription.upsert({
    where: { userId },
    update: {
      planId,
      status: 'active',
      billingCycle,
      startedAt: new Date(),
      expiresAt,
      cancelledAt: null,
      paymentProvider: 'stripe',
      providerSubscriptionId,
    },
    create: {
      userId,
      planId,
      status: 'active',
      billingCycle,
      expiresAt,
      paymentProvider: 'stripe',
      providerSubscriptionId,
    },
  })

  const plan = await db.membershipPlan.findUnique({ where: { id: planId }, select: { slug: true } })
  if (plan?.slug === 'club') {
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, clubName: true },
    })
    await db.club.upsert({
      where: { ownerId: userId },
      update: {},
      create: { ownerId: userId, name: user.clubName || `${user.name}'s Club` },
    })
  }
}

/** Sync status/period changes pushed by Stripe (renewals, cancellations…). */
export async function syncSubscriptionFromStripe(
  providerSubscriptionId: string,
  data: { status: 'active' | 'cancelled' | 'expired'; expiresAt: Date | null },
): Promise<void> {
  await db.userSubscription.updateMany({
    where: { providerSubscriptionId },
    data: {
      status: data.status,
      expiresAt: data.expiresAt,
      ...(data.status === 'cancelled' && { cancelledAt: new Date() }),
    },
  })
}
