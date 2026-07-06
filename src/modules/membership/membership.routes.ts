import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { db } from '../../config/database.js'
import { env } from '../../config/env.js'
import { stripe, stripeConfigured } from '../../config/stripe.js'
import { getEntitlements } from '../../lib/entitlements.js'
import { ensureStripeCustomer } from './membership.service.js'

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
    return reply.send(await getEntitlements(userId))
  })

  // POST /membership/checkout { planSlug, cycle } → Stripe Checkout URL.
  // Prices come straight from the plans table (inline price_data), so no
  // Stripe dashboard product setup is needed beyond API keys.
  app.post('/checkout', { preHandler: authGuard }, async (request, reply) => {
    if (!stripeConfigured()) {
      return reply.status(503).send({ statusCode: 503, error: 'Service Unavailable', message: 'Billing is not configured on this server' })
    }
    const userId = (request.user as any).sub as number
    const { planSlug, cycle } = CheckoutSchema.parse(request.body)

    const plan = await db.membershipPlan.findUnique({ where: { slug: planSlug } })
    if (!plan || !plan.isActive) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Plan not found' })
    }
    const price = cycle === 'annual' ? plan.annualPrice : plan.monthlyPrice
    if (!price) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'This plan has no price for that billing cycle' })
    }

    const customerId = await ensureStripeCustomer(userId)
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: plan.currency.toLowerCase(),
            product_data: {
              name: `TactiCoach ${plan.name}`,
              description: plan.description ?? undefined,
            },
            unit_amount: Math.round(Number(price) * 100),
            recurring: { interval: cycle === 'annual' ? 'year' : 'month' },
          },
        },
      ],
      metadata: { userId: String(userId), planId: String(plan.id), cycle },
      subscription_data: {
        metadata: { userId: String(userId), planId: String(plan.id), cycle },
      },
      success_url: `${env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.FRONTEND_URL}/?checkout=cancelled#pricing`,
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
    if (sub.paymentProvider === 'stripe' && sub.providerSubscriptionId && stripeConfigured()) {
      await stripe().subscriptions.update(sub.providerSubscriptionId, { cancel_at_period_end: true })
    }
    const updated = await db.userSubscription.update({
      where: { userId },
      data: { status: 'cancelled', cancelledAt: new Date() },
      include: { plan: true },
    })
    return reply.send(updated)
  })
}
