// FINANCE · import from Stripe (28 Oct 2026, owner). Reads the account's
// balance transactions — the one Stripe record with the settled amount (INR),
// the fee and the net — and stores one row each. Safe to repeat: the balance
// transaction id is unique. Payouts (money moving to the bank) are skipped:
// they are not income.
import type Stripe from 'stripe'
import { db } from '../../../config/database.js'
import { stripe } from '../../../config/stripe.js'
import type { TxnKind } from './pnl.js'

const SKIP = new Set(['payout', 'payout_cancel', 'payout_failure', 'payout_minimum_balance_hold', 'payout_minimum_balance_release', 'transfer', 'transfer_cancel', 'transfer_failure', 'transfer_refund'])
const FEES = new Set(['stripe_fee', 'tax_fee', 'application_fee', 'stripe_fx_fee', 'network_cost'])

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : v?.id ?? null)

export interface Classified {
  kind: TxnKind
  refundOf: TxnKind | null
  chargeAmount: number | null
  chargeCurrency: string | null
  paymentIntent: string | null
  customer: string | null
}

/**
 * What a balance transaction is. `isBookIntent` answers whether a payment
 * intent belongs to a book purchase (the purchase table is the truth; the
 * charge's metadata is the quick path).
 */
export async function classify(bt: Stripe.BalanceTransaction, isBookIntent: (pi: string) => Promise<boolean>): Promise<Classified | null> {
  if (SKIP.has(bt.type)) return null
  const src = bt.source && typeof bt.source === 'object' ? (bt.source as unknown as Record<string, unknown>) : null
  if (bt.type === 'charge' || bt.type === 'payment') {
    const charge = src as unknown as Stripe.Charge | null
    const pi = charge ? idOf(charge.payment_intent as never) : null
    const book = charge?.metadata?.kind === 'book' || (pi ? await isBookIntent(pi) : false)
    return {
      kind: book ? 'book' : 'subscription', refundOf: null,
      chargeAmount: charge?.amount ?? null, chargeCurrency: charge?.currency ?? null,
      paymentIntent: pi, customer: charge ? idOf(charge.customer as never) : null,
    }
  }
  if (bt.type === 'refund' || bt.type === 'payment_refund') {
    const refund = src as unknown as Stripe.Refund | null
    const pi = refund ? idOf(refund.payment_intent as never) : null
    const book = refund?.metadata?.kind === 'book' || (pi ? await isBookIntent(pi) : false)
    return {
      kind: 'refund', refundOf: book ? 'book' : 'subscription',
      chargeAmount: refund ? -refund.amount : null, chargeCurrency: refund?.currency ?? null,
      paymentIntent: pi, customer: null,
    }
  }
  if (FEES.has(bt.type)) return { kind: 'fee', refundOf: null, chargeAmount: null, chargeCurrency: null, paymentIntent: null, customer: null }
  return { kind: 'other', refundOf: null, chargeAmount: null, chargeCurrency: null, paymentIntent: null, customer: null }
}

export async function syncFromStripe(): Promise<{ added: number; seen: number }> {
  const last = await db.financeTransaction.findFirst({ orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } })
  // Two days of overlap: a late-settling charge is picked up; duplicates are skipped by id.
  const gte = last ? Math.floor(last.occurredAt.getTime() / 1000) - 2 * 86400 : undefined
  const isBookIntent = async (pi: string) => !!(await db.ebookPurchase.findFirst({ where: { providerRef: pi }, select: { id: true } }))
  let added = 0
  let seen = 0
  const list = stripe().balanceTransactions.list({ limit: 100, expand: ['data.source'], ...(gte ? { created: { gte } } : {}) })
  for await (const bt of list) {
    seen += 1
    const exists = await db.financeTransaction.findUnique({ where: { stripeTxnId: bt.id }, select: { id: true } })
    if (exists) continue
    const c = await classify(bt, isBookIntent)
    if (!c) continue
    const user = c.customer ? await db.user.findUnique({ where: { stripeCustomerId: c.customer }, select: { id: true } }) : null
    await db.financeTransaction.create({
      data: {
        stripeTxnId: bt.id, kind: c.kind, refundOf: c.refundOf, currency: bt.currency,
        amount: bt.amount, fee: bt.fee, net: bt.net,
        chargeAmount: c.chargeAmount, chargeCurrency: c.chargeCurrency, paymentIntent: c.paymentIntent,
        userId: user?.id ?? null, description: (bt.description ?? '').slice(0, 255),
        occurredAt: new Date(bt.created * 1000),
      },
    })
    added += 1
  }
  return { added, seen }
}
