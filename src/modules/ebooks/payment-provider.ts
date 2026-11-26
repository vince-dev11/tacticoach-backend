import { env } from '../../config/env.js'
import { stripe, stripeConfigured } from '../../config/stripe.js'
import { paddle, paddleConfigured } from '../../config/paddle.js'
import { checkoutUrl, ensurePaddleCustomer, ONE_ONLY } from '../membership/paddle-billing.js'
import { db } from '../../config/database.js'

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
  /** PADDLE: the buyer, so the transaction is on their own Paddle customer. */
  userId?: number
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
  if (!env.BOOK_SALES) return null
  // PADDLE (25 Nov 2026): Paddle first once its key is set. Keep BOOK_SALES
  // off on Paddle until Paddle has agreed to the books in writing (setup doc,
  // decision A).
  if (paddleConfigured()) return paddleBookCheckout
  if (stripeConfigured()) return stripeBookCheckout
  return null
}

/**
 * PADDLE: the tax category books are sold under. 'standard' until Paddle
 * approves the eBook category on our account (Settings → Taxable categories),
 * then set PADDLE_BOOK_TAX_CATEGORY=ebooks.
 */
// Paddle's tax categories (developer.paddle.com → products). Anything else in
// the env — a typo, a note — would fail every book checkout, so it falls back
// to 'standard' (26 Nov 2026: a note left in .env broke the sandbox test).
const PADDLE_TAX_CATEGORIES = new Set([
  'digital-goods', 'ebooks', 'implementation-services', 'professional-services',
  'saas', 'software-programming-services', 'standard', 'training-services', 'website-hosting',
])

export function bookTaxCategory(raw = process.env.PADDLE_BOOK_TAX_CATEGORY): string {
  const v = raw?.trim().toLowerCase() ?? ''
  return PADDLE_TAX_CATEGORIES.has(v) ? v : 'standard'
}

/** One Paddle product for every book; each sale carries its own price. */
async function ensureBookProduct(): Promise<string> {
  const key = 'product:book'
  const known = await db.paddleCatalog.findUnique({ where: { key } })
  if (known) return known.paddleId
  const product = await paddle<{ id: string }>('POST', '/products', {
    name: 'TactiCoach coaching book',
    tax_category: bookTaxCategory(),
    description: 'A coaching book, read online in TactiCoach.',
    custom_data: { kind: 'book' },
  })
  try {
    await db.paddleCatalog.create({ data: { key, paddleId: product.id } })
    return product.id
  } catch {
    return (await db.paddleCatalog.findUnique({ where: { key } }))?.paddleId ?? product.id
  }
}

/**
 * One-off payment for one book on Paddle: a transaction at the book's price
 * (set here from our row), opened on our /checkout page. The webhook marks the
 * purchase paid only when the completed transaction IS this one (providerRef).
 */
export const paddleBookCheckout: BookCheckoutProvider = {
  name: 'paddle',
  async createCheckout(req) {
    if (!req.userId) throw new Error('Paddle book checkout needs the buyer')
    const [customerId, productId] = await Promise.all([ensurePaddleCustomer(req.userId), ensureBookProduct()])
    const txn = await paddle<{ id: string }>('POST', '/transactions', {
      items: [{
        quantity: 1,
        price: {
          description: 'TactiCoach coaching book (digital, read online)',
          name: req.title.slice(0, 150),
          product_id: productId,
          unit_price: { amount: String(req.amountPence), currency_code: req.currency.toUpperCase() },
          tax_mode: 'account_setting',
          quantity: ONE_ONLY, // PADDLE-QTY: one book, one copy
        },
      }],
      customer_id: customerId,
      collection_mode: 'automatic',
      custom_data: { kind: 'book', purchaseId: String(req.purchaseId) },
    })
    const back = new URL(req.successUrl)
    return { url: checkoutUrl(txn.id, back.pathname), ref: txn.id }
  },
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
  // PADDLE: a transaction nobody paid is cancelled (refused once it is paid — fine).
  if (sessionId.startsWith('txn_') && paddleConfigured()) {
    await paddle('PATCH', `/transactions/${encodeURIComponent(sessionId)}`, { status: 'canceled' }).catch(() => {})
    return
  }
  if (!sessionId.startsWith('cs_') || !stripeConfigured()) return
  await stripe().checkout.sessions.expire(sessionId).catch(() => {})
}

/** Give the money back for a book bought through Stripe. */
export async function refundBookPayment(providerRef: string | null | undefined): Promise<boolean> {
  // PADDLE: a refund adjustment; Paddle approves it and the webhook confirms.
  if (providerRef?.startsWith('txn_') && paddleConfigured()) {
    await paddle('POST', '/adjustments', { action: 'refund', transaction_id: providerRef, type: 'full', reason: 'Book refund' })
    return true
  }
  if (!providerRef?.startsWith('pi_') || !stripeConfigured()) return false
  await stripe().refunds.create({ payment_intent: providerRef, metadata: { kind: 'book' } })
  return true
}
