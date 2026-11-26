// PADDLE (25 Nov 2026): Paddle's webhook — the source of truth for plans and
// books paid through Paddle, exactly as stripe.routes.ts is for Stripe.
//
//   transaction.completed   → a book is paid (only the transaction WE created
//                             for that purchase); a plan payment earns
//                             referral credit and partner commission
//   subscription.created    → activate the plan
//   subscription.updated    → renewals, plan changes, scheduled cancel, past due
//   subscription.canceled   → access ends
//   adjustment.created/updated (approved refund or chargeback) → the book is
//                             taken back; commission and referral reversed
//
// Trust rules: the signature is checked on the RAW body; who is paying comes
// from the Paddle customer we created for that account (never from
// custom_data alone — Paddle.js lets a browser set custom_data); which plan
// comes from the Paddle price, mapped through our own catalog.

import type { FastifyInstance } from 'fastify'
import { env } from '../../config/env.js'
import { verifyPaddleSignature } from '../../config/paddle.js'
import { db } from '../../config/database.js'
import { captureError } from '../../lib/observability.js'
import { activateSubscription, syncSubscription } from '../membership/membership.service.js'
import { accessEndsAt, netOfTax, planForPaddlePrice, type PaddleSubscription, type PaddleTransaction } from '../membership/paddle-billing.js'
import { markPaid, refundPurchase } from '../ebooks/purchases.service.js'
import { qualifyPendingFor, qualifyReferral, reverseReferral } from '../referrals/referrals.service.js'
import { recordCommission, reverseCommission } from '../collaborations/collaborations.service.js'

interface PaddleEventBody {
  event_id: string
  event_type: string
  occurred_at?: string
  data: Record<string, unknown>
}

interface PaddleAdjustment {
  id: string
  action: string
  status: string
  transaction_id: string
  customer_id: string
  subscription_id?: string | null
}

async function firstDelivery(event: PaddleEventBody): Promise<boolean> {
  try {
    await db.paddleEvent.create({ data: { id: event.event_id, type: event.event_type.slice(0, 100) } })
    return true
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return false
    throw err
  }
}

async function forgetEvent(id: string): Promise<void> {
  await db.paddleEvent.delete({ where: { id } }).catch(() => {})
}

/** The account whose Paddle customer this is — the only way a payment is tied to a person. */
async function userForCustomer(customerId: string | null | undefined): Promise<{ id: number } | null> {
  if (!customerId) return null
  return db.user.findUnique({ where: { paddleCustomerId: customerId }, select: { id: true } })
}

/** Our subscription status for a Paddle one. */
export function statusFor(sub: Pick<PaddleSubscription, 'status' | 'scheduled_change'>): 'active' | 'cancelled' | 'expired' {
  if (sub.status === 'canceled' || sub.status === 'paused') return 'expired'
  // past_due keeps access while Paddle retries the card; its dunning ends in canceled.
  return sub.scheduled_change?.action === 'cancel' ? 'cancelled' : 'active'
}

async function activateFrom(sub: PaddleSubscription, log: FastifyInstance['log']): Promise<void> {
  const user = await userForCustomer(sub.customer_id)
  const plan = await planForPaddlePrice(sub.items?.[0]?.price?.id)
  if (!user || !plan) {
    log.warn({ sub: sub.id }, 'Paddle subscription with no matching account or plan — ignored')
    captureError(new Error(`Paddle subscription ${sub.id} not matched (user ${!!user}, plan ${!!plan})`), { source: 'webhook:paddle', tags: { step: 'activate' } })
    return
  }
  // PADDLE-QTY: prices are quantity 1 only; anything else was charged more
  // than the plan gives — flag it for a refund.
  const qty = sub.items?.[0]?.quantity ?? 1
  if (qty !== 1) {
    captureError(new Error(`Paddle subscription ${sub.id} has quantity ${qty} — refund the extra in Paddle`), { source: 'webhook:paddle', tags: { step: 'quantity' } })
  }
  // A custom_data userId that disagrees with the customer is someone else's
  // checkout opened with another account's id — record the payer, flag it.
  const claimed = Number(sub.custom_data?.userId)
  if (claimed && claimed !== user.id) {
    captureError(new Error(`Paddle subscription ${sub.id}: custom_data user ${claimed} ≠ customer's user ${user.id}`), { source: 'webhook:paddle', tags: { step: 'user-mismatch' } })
  }
  // Two checkout tabs paid → two Paddle subscriptions billing one coach. Keep
  // the newest (it's what they just chose) and flag it, so the owner cancels
  // and refunds the other in Paddle.
  const current = await db.userSubscription.findUnique({ where: { userId: user.id }, select: { paymentProvider: true, providerSubscriptionId: true, status: true } })
  if (current?.paymentProvider === 'paddle' && current.providerSubscriptionId && current.providerSubscriptionId !== sub.id && current.status !== 'expired') {
    captureError(new Error(`Coach ${user.id} now has two Paddle subscriptions (${current.providerSubscriptionId}, ${sub.id}) — cancel and refund the older one in Paddle`), { source: 'webhook:paddle', tags: { step: 'second-subscription' } })
  }
  await activateSubscription({
    userId: user.id,
    planId: plan.planId,
    billingCycle: plan.cycle,
    providerSubscriptionId: sub.id,
    expiresAt: accessEndsAt(sub),
    provider: 'paddle',
  })
}

export async function paddleWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body)
  })

  // POST /webhooks/paddle
  app.post('/paddle', async (request, reply) => {
    if (!env.PADDLE_WEBHOOK_SECRET) return reply.status(503).send({ received: false })

    const raw = request.body as Buffer
    const signature = request.headers['paddle-signature'] as string | undefined
    if (!Buffer.isBuffer(raw) || !verifyPaddleSignature(raw, signature, env.PADDLE_WEBHOOK_SECRET)) {
      request.log.warn('Paddle webhook signature verification failed')
      return reply.status(400).send({ received: false })
    }

    let event: PaddleEventBody
    try {
      event = JSON.parse(raw.toString('utf8')) as PaddleEventBody
    } catch {
      return reply.status(400).send({ received: false })
    }
    if (!event?.event_id || !event.event_type || !event.data) return reply.status(400).send({ received: false })

    if (!(await firstDelivery(event))) return reply.send({ received: true, duplicate: true })

    try {
      switch (event.event_type) {
        case 'transaction.completed': {
          const txn = event.data as unknown as PaddleTransaction
          if (txn.custom_data?.kind === 'book') {
            const purchaseId = Number(txn.custom_data.purchaseId)
            const row = purchaseId
              ? await db.ebookPurchase.findUnique({ where: { id: purchaseId }, select: { id: true, providerRef: true, status: true } })
              : null
            // Only the transaction we opened for this purchase can pay for it
            // (a browser can set custom_data on a checkout of its own).
            if (!row || row.providerRef !== txn.id) {
              captureError(new Error(`Paddle book payment ${txn.id} does not match purchase ${purchaseId}`), { source: 'webhook:paddle', tags: { step: 'book-mismatch' } })
              break
            }
            // PAY-AMOUNT: what was actually paid, without tax (never ours).
            await markPaid(row.id, txn.id, { amountPence: netOfTax(txn), currency: txn.currency_code ?? '' })
            break
          }
          if (txn.subscription_id) {
            const user = await userForCustomer(txn.customer_id)
            if (!user) break
            // A payment that actually cleared — the only thing that earns.
            await qualifyReferral(user.id, txn.id)
            await qualifyPendingFor(user.id)
            await recordCommission({
              customerId: user.id,
              providerInvoiceId: txn.id,
              netAmount: netOfTax(txn),
              currency: (txn.currency_code ?? 'GBP').toLowerCase(),
            })
          }
          break
        }

        case 'subscription.created': {
          const sub = event.data as unknown as PaddleSubscription
          if (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due') await activateFrom(sub, request.log)
          break
        }

        case 'subscription.updated': {
          const sub = event.data as unknown as PaddleSubscription
          const plan = await planForPaddlePrice(sub.items?.[0]?.price?.id)
          const status = statusFor(sub)
          const changed = await syncSubscription(sub.id, {
            status,
            expiresAt: accessEndsAt(sub),
            ...(plan ? { planId: plan.planId, billingCycle: plan.cycle } : {}),
          })
          // Arrived before subscription.created (deliveries can be out of order).
          if (!changed && status !== 'expired') await activateFrom(sub, request.log)
          break
        }

        case 'subscription.canceled': {
          const sub = event.data as unknown as PaddleSubscription
          await syncSubscription(sub.id, { status: 'expired', expiresAt: new Date() })
          break
        }

        case 'adjustment.created':
        case 'adjustment.updated': {
          const adj = event.data as unknown as PaddleAdjustment
          // Refunds wait for Paddle's approval; chargebacks arrive approved.
          if (adj.status !== 'approved' || !['refund', 'chargeback', 'chargeback_warning'].includes(adj.action)) break
          if (adj.action === 'chargeback_warning') break
          const book = await db.ebookPurchase.findFirst({ where: { providerRef: adj.transaction_id, status: 'paid' }, select: { id: true } })
          if (book) {
            await refundPurchase(book.id, adj.action === 'chargeback' ? 'Chargeback in Paddle' : 'Refunded in Paddle', { alreadyRefunded: true })
            break
          }
          await reverseCommission(adj.transaction_id)
          const user = await userForCustomer(adj.customer_id)
          if (user) await reverseReferral(user.id)
          break
        }

        default:
          break
      }
    } catch (err) {
      // Let Paddle retry: forget the event and answer 500.
      await forgetEvent(event.event_id)
      captureError(err, { source: 'webhook:paddle', tags: { type: event.event_type } })
      throw err
    }

    return reply.send({ received: true })
  })
}
