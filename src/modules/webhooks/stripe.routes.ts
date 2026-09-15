// Stripe webhook — the source of truth for subscription state.
//
// checkout.session.completed  → activate the subscription (and create the
//                               user's Club when it's the club plan)
// customer.subscription.updated → sync status / period end (renewals,
//                               cancel-at-period-end)
// customer.subscription.deleted → mark expired
//
// Signature verification needs the RAW request body, so this plugin registers
// its own buffer content-type parser — scoped here, it doesn't affect the
// JSON parsing of the rest of the API.

import type { FastifyInstance } from 'fastify'
import type Stripe from 'stripe'
import { env } from '../../config/env.js'
import { stripe, stripeConfigured } from '../../config/stripe.js'
import { activateSubscription, syncSubscriptionFromStripe } from '../membership/membership.service.js'
import { db } from '../../config/database.js'
import { qualifyReferral, reverseReferral } from '../referrals/referrals.service.js'
import { recordCommission, reverseCommission } from '../partners/partners.service.js'

function periodEnd(sub: Stripe.Subscription): Date | null {
  const end = sub.items.data[0]?.current_period_end
  return end ? new Date(end * 1000) : null
}

export async function stripeWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body)
  })

  // POST /webhooks/stripe
  app.post('/stripe', async (request, reply) => {
    if (!stripeConfigured() || !env.STRIPE_WEBHOOK_SECRET) {
      return reply.status(503).send({ received: false })
    }

    let event: Stripe.Event
    try {
      event = stripe().webhooks.constructEvent(
        request.body as Buffer,
        request.headers['stripe-signature'] as string,
        env.STRIPE_WEBHOOK_SECRET,
      )
    } catch (err) {
      request.log.warn({ err }, 'Stripe webhook signature verification failed')
      return reply.status(400).send({ received: false })
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = Number(session.metadata?.userId)
        const planId = Number(session.metadata?.planId)
        const cycle = session.metadata?.cycle === 'annual' ? 'annual' : 'monthly'
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
        if (!userId || !planId || !subscriptionId) break

        const sub = await stripe().subscriptions.retrieve(subscriptionId)
        await activateSubscription({
          userId,
          planId,
          billingCycle: cycle,
          providerSubscriptionId: subscriptionId,
          expiresAt: periodEnd(sub),
        })
        break
      }

      // A payment that actually cleared — the only event that earns anything.
      // Referral credit and partner commission both hang off this rather than
      // off checkout, because a checkout that later fails or is refunded must
      // not have paid anyone in the meantime.
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
        if (!customerId || !invoice.id) break

        const user = await db.user.findUnique({
          where: { stripeCustomerId: customerId },
          select: { id: true },
        })
        if (!user) break

        // `amount_paid` is what actually moved, after any discount or balance
        // credit — commission on the list price of a discounted first month
        // would pay out more than we took in.
        const net = (invoice.amount_paid ?? 0) - (invoice.tax ?? 0)

        await qualifyReferral(user.id)
        await recordCommission({
          customerId: user.id,
          providerInvoiceId: invoice.id,
          netAmount: net,
          currency: invoice.currency ?? 'gbp',
        })
        break
      }

      // Refund or chargeback: the referral stops counting and the commission
      // line is reversed (agreement §5).
      case 'charge.refunded': {
        const charge = event.data.object
        const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id
        if (invoiceId) await reverseCommission(invoiceId)

        const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id
        if (customerId) {
          const user = await db.user.findUnique({
            where: { stripeCustomerId: customerId },
            select: { id: true },
          })
          if (user) await reverseReferral(user.id)
        }
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object
        const status =
          sub.status === 'active' || sub.status === 'trialing'
            ? sub.cancel_at_period_end
              ? 'cancelled'
              : 'active'
            : sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'incomplete_expired'
              ? 'expired'
              : 'cancelled'
        await syncSubscriptionFromStripe(sub.id, { status, expiresAt: periodEnd(sub) })
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
        await syncSubscriptionFromStripe(sub.id, { status: 'expired', expiresAt: periodEnd(sub) })
        break
      }

      default:
        break
    }

    return reply.send({ received: true })
  })
}
