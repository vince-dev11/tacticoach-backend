import { env } from '../../config/env.js'
import { stripe, stripeConfigured } from '../../config/stripe.js'

// The one place a payment gateway plugs into the book shop.
//
// BILLING (20 Oct 2026): Stripe. The shop goes live the moment the Stripe keys
// are set (BOOK_SALES=false closes it again). Checkout is Stripe's hosted page;
// its webhook (webhooks/stripe.routes.ts) calls `markPaid(purchaseId,
// paymentIntentId)` when the money clears. The rest of the shop — ownership,
// the reader, the library, receipts, author shares — did not change.
//
// Card details never touch our pages or our server: the provider's hosted
// checkout collects them. That keeps us out of PCI scope.

export interface BookCheckoutRequest {
  purchaseId: number
  amountPence: number
  currency: string
  title: string
  customerEmail: string
  /** Where the provider sends the buyer back to. */
  successUrl: string
  cancelUrl: string
}

export interface BookCheckoutProvider {
  /** Stored on the purchase: 'stripe', 'paddle'… */
  name: string
  /** Opens a hosted checkout; the buyer is sent to `url`. `ref` identifies it in the webhook. */
  createCheckout(req: BookCheckoutRequest): Promise<{ url: string; ref: string }>
}

/**
 * The live gateway, or null while there is none. With null the shop shows
 * "Buying opens soon" (plus a notify-me list) to everyone except the owner,
 * who can make test purchases to see the whole flow.
 */
export function bookCheckoutProvider(): BookCheckoutProvider | null {
  if (!stripeConfigured() || !env.BOOK_SALES) return null
  return stripeBookCheckout
}

/** One-off payment for one book, on Stripe's hosted checkout. */
export const stripeBookCheckout: BookCheckoutProvider = {
  name: 'stripe',
  async createCheckout(req) {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: req.customerEmail,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: req.currency.toLowerCase(),
          unit_amount: req.amountPence,
          product_data: { name: req.title, description: 'TactiCoach coaching book (digital, read online)' },
        },
      }],
      // The webhook finds the purchase by these; the payment intent carries
      // them too, so a refund made in the Stripe dashboard is traced back.
      metadata: { kind: 'book', purchaseId: String(req.purchaseId) },
      payment_intent_data: { metadata: { kind: 'book', purchaseId: String(req.purchaseId) } },
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
    })
    if (!session.url) throw new Error('Stripe did not return a checkout URL')
    return { url: session.url, ref: session.id }
  },
}

/**
 * PAY-STALE: close a book checkout page that was never paid, so it cannot be
 * paid later at the price it was opened with. Already completed or expired
 * sessions refuse — that is fine, there is nothing to close.
 */
export async function expireBookCheckout(sessionId: string): Promise<void> {
  if (!sessionId.startsWith('cs_') || !stripeConfigured()) return
  await stripe().checkout.sessions.expire(sessionId).catch(() => {})
}

/** Give the money back for a book bought through Stripe. */
export async function refundBookPayment(providerRef: string | null | undefined): Promise<boolean> {
  if (!providerRef?.startsWith('pi_') || !stripeConfigured()) return false
  await stripe().refunds.create({ payment_intent: providerRef, metadata: { kind: 'book' } })
  return true
}
