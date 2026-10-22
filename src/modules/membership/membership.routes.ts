import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { db } from '../../config/database.js'
import { env } from '../../config/env.js'
import { stripe, stripeConfigured } from '../../config/stripe.js'
import { getEntitlements } from '../../lib/entitlements.js'
import { grantedCapabilities, limitsFor, isPaidPlan } from '../../lib/capabilities.js'
import { videoQuota } from '../../lib/video-quota.js'
import { allQuotas } from '../../lib/plan-quota.js'
import { ensureStripeCustomer } from './membership.service.js'
import { ensurePortalConfiguration, ensurePrice, toMinorUnits } from './stripe-catalog.js'
import { subIsActive } from '../../lib/entitlements.js'

const CheckoutSchema = z.object({
  planSlug: z.string().min(1),
  cycle: z.enum(['monthly', 'annual']).default('monthly'),
})

export async function membershipRoutes(app: FastifyInstance) {
  // GET /membership/plans — public, no auth needed
  app.get('/plans', async (_request, reply) => {
    const plans = await db.membershipPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        monthlyPrice: true,
        annualPrice: true,
        currency: true,
        features: true,
        maxBoards: true,
        maxTeamMembers: true,
      },
    })
    return reply.send(plans)
  })

  // NOTE: an addHook('preHandler') here would guard ALL routes in this plugin
  // — including GET /plans above, which must stay public (Fastify applies
  // plugin-scope hooks regardless of declaration order). Guard per-route.

  // GET /membership/my — current user's subscription
  app.get('/my', { preHandler: authGuard }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const subscription = await db.userSubscription.findUnique({
      where: { userId },
      include: { plan: true },
    })
    return reply.send(subscription ?? null)
  })

  // GET /membership/entitlements — what the user can access (drives the
  // frontend's editor gating and the post-purchase redirect).
  app.get('/entitlements', { preHandler: authGuard }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const ent = await getEntitlements(userId)
    // Capabilities, limits and the video meter ride along on the call the
    // frontend already makes. They are sent rather than derived client-side
    // because a second copy of the tier table is the one that goes stale —
    // and they are sent here rather than on a new endpoint because the
    // alternative is the editor firing a quota request on every load.
    return reply.send({
      ...ent,
      capabilities: grantedCapabilities(ent),
      limits: limitsFor(ent),
      // Lets the editor check BEFORE it spends thirty seconds encoding a
      // video the server is going to refuse. The server still checks on
      // upload — this is courtesy, not enforcement.
      videoQuota: await videoQuota(userId),
      // The counted limits, so the UI can say "4 of 5 boards" while there is
      // still time to act on it. A free tier whose only signal is the refusal
      // at number six feels broken; one that shows the count feels like a
      // plan. Same data, entirely different product.
      quotas: await allQuotas(userId),
      paid: isPaidPlan(ent.plan?.slug),
    })
  })

  // POST /membership/checkout { planSlug, cycle } → { url }.
  //
  // BILLING (20 Oct 2026): prices come from the plans table and are turned
  // into Stripe Prices on first use (stripe-catalog.ts), so going live needs
  // only the API keys. A coach who already pays by card and picks another plan
  // is moved in place (one subscription, prorated) instead of being sent to a
  // second checkout — two live subscriptions would bill them twice.
  app.post('/checkout', { preHandler: authGuard }, async (request, reply) => {
    if (!stripeConfigured()) {
      return reply.status(503).send({ statusCode: 503, error: 'Service Unavailable', message: 'Billing is not configured on this server' })
    }
    const userId = (request.user as any).sub as number
    const { planSlug, cycle } = CheckoutSchema.parse(request.body)

    // FAMILY: a minor never buys (checkout of books is refused the same way).
    const buyer = await db.user.findUnique({ where: { id: userId }, select: { accountType: true, dateOfBirth: true } })
    if (buyer && (buyer.accountType === 'player' || buyer.accountType === 'parent')) {
      return reply.status(403).send({ statusCode: 403, error: 'not_a_coach', message: 'Plans are for coach and club accounts.' })
    }

    const plan = await db.membershipPlan.findUnique({ where: { slug: planSlug } })
    if (!plan || !plan.isActive) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Plan not found' })
    }
    const price = cycle === 'annual' ? plan.annualPrice : plan.monthlyPrice
    if (!price || Number(price) <= 0) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'This plan has no price for that billing cycle' })
    }
    const priceId = await ensurePrice(plan, cycle, toMinorUnits(price))

    // Already paying by card? Change the plan on that subscription.
    const current = await db.userSubscription.findUnique({ where: { userId } })
    if (current?.paymentProvider === 'stripe' && current.providerSubscriptionId && subIsActive(current)) {
      const sub = await stripe().subscriptions.retrieve(current.providerSubscriptionId)
      if (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due') {
        const item = sub.items.data[0]
        if (item?.price.id === priceId) {
          return reply.status(409).send({ statusCode: 409, error: 'same_plan', message: 'You are already on this plan.' })
        }
        await stripe().subscriptions.update(sub.id, {
          items: [{ id: item.id, price: priceId }],
          proration_behavior: 'create_prorations',
          cancel_at_period_end: false,
          metadata: { userId: String(userId), planId: String(plan.id), cycle },
        })
        await db.userSubscription.update({
          where: { userId },
          data: { planId: plan.id, billingCycle: cycle, status: 'active', cancelledAt: null },
        })
        return reply.send({ url: `${env.FRONTEND_URL}/billing/success?changed=1`, changed: true })
      }
    }

    const customerId = await ensureStripeCustomer(userId)
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      // RBI cross-border rules for Indian Stripe accounts: export transactions
      // must carry the customer's name and billing address, and a clear
      // description of the service sold (the product carries it).
      // Harmless on non-Indian Stripe accounts — just collects the address.
      billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'auto' },
      line_items: [{ quantity: 1, price: priceId }],
      allow_promotion_codes: true,
      metadata: { kind: 'subscription', userId: String(userId), planId: String(plan.id), cycle },
      subscription_data: {
        metadata: { userId: String(userId), planId: String(plan.id), cycle },
      },
      success_url: `${env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.FRONTEND_URL}/?checkout=cancelled#pricing`,
    })

    return reply.send({ url: session.url })
  })

  // POST /membership/portal → { url } — Stripe's own page to update the card,
  // download invoices, change billing details or cancel (at period end).
  app.post('/portal', { preHandler: authGuard }, async (request, reply) => {
    if (!stripeConfigured()) {
      return reply.status(503).send({ statusCode: 503, error: 'Service Unavailable', message: 'Billing is not configured on this server' })
    }
    const userId = (request.user as any).sub as number
    const user = await db.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } })
    if (!user?.stripeCustomerId) {
      return reply.status(404).send({ statusCode: 404, error: 'no_billing', message: 'There is no card billing on this account yet.' })
    }
    const session = await stripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      configuration: await ensurePortalConfiguration(),
      return_url: `${env.FRONTEND_URL}/profile#account`,
    })
    return reply.send({ url: session.url })
  })

  // PATCH /membership/cancel — cancel at period end via Stripe.
  app.patch('/cancel', { preHandler: authGuard }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const sub = await db.userSubscription.findUnique({ where: { userId } })
    if (!sub) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'No subscription to cancel' })
    }
    let expiresAt = sub.expiresAt
    if (sub.paymentProvider === 'stripe' && sub.providerSubscriptionId && stripeConfigured()) {
      const updatedSub = await stripe().subscriptions.update(sub.providerSubscriptionId, { cancel_at_period_end: true })
      const end = updatedSub.items.data[0]?.current_period_end
      if (end) expiresAt = new Date(end * 1000)
    }
    // BILLING: 'cancelled' with a future expiresAt still has access until then
    // (entitlements.subIsActive) — they paid for the period.
    const updated = await db.userSubscription.update({
      where: { userId },
      data: { status: 'cancelled', cancelledAt: new Date(), expiresAt },
      include: { plan: true },
    })
    return reply.send(updated)
  })
}
