// PADDLE (25 Nov 2026): plans on Paddle Billing.
//
// Same rules as the Stripe path (payments-security):
//   - the price comes from OUR plans table; the browser only names a plan;
//   - our ids (user, plan, cycle) ride on the transaction as custom_data set
//     HERE, so the browser can't change who or what is being paid for;
//   - access is granted only by the webhook (webhooks/paddle.routes.ts).
//
// Paddle products and prices are created on first use and remembered in
// `paddle_catalog`, so going live needs only the API key (as with Stripe).

import { db } from '../../config/database.js'
import { env } from '../../config/env.js'
import { paddle, PaddleError } from '../../config/paddle.js'

export type Cycle = 'monthly' | 'annual'

interface PlanRow {
  id: number
  slug: string
  name: string
  description?: string | null
  currency: string
}

async function remembered(key: string): Promise<string | null> {
  const row = await db.paddleCatalog.findUnique({ where: { key } })
  return row?.paddleId ?? null
}

async function remember(key: string, paddleId: string): Promise<string> {
  // Two first-uses at once: the unique key keeps one; read it back.
  try {
    await db.paddleCatalog.create({ data: { key, paddleId } })
    return paddleId
  } catch {
    return (await remembered(key)) ?? paddleId
  }
}

/** The Paddle product for a plan (tax category SaaS, approved on our account). */
export async function ensurePlanProduct(plan: PlanRow): Promise<string> {
  const key = `product:${plan.slug}`
  const known = await remembered(key)
  if (known) return known
  const product = await paddle<{ id: string }>('POST', '/products', {
    name: `TactiCoach ${plan.name}`,
    tax_category: 'saas',
    description: plan.description?.slice(0, 2000) || `TactiCoach ${plan.name} plan`,
    custom_data: { slug: plan.slug },
  })
  return remember(key, product.id)
}

// PADDLE-QTY (26 Nov 2026, sandbox test): plan prices are quantity 1 only —
// Paddle's checkout showed a – 1 + stepper, so a coach could pay for two Pro
// plans and get one. ':q1' marks prices created with that limit; prices
// created before it stay in the catalog so existing subscriptions still map.
export const ONE_ONLY = { minimum: 1, maximum: 1 } as const

export function priceKey(slug: string, cycle: Cycle, amountMinor: number, currency: string): string {
  return `price:${slug}:${cycle}:${amountMinor}:${currency.toUpperCase()}:q1`
}

/**
 * The Paddle price for plan × cycle × amount. A changed amount is a new key
 * and so a new Paddle price — existing subscribers keep theirs until moved.
 * Tax mode follows the account setting (set "inclusive" in the dashboard so
 * £8.99 is what a UK coach pays — setup doc, decision D).
 */
export async function ensurePlanPrice(plan: PlanRow, cycle: Cycle, amountMinor: number): Promise<string> {
  const key = priceKey(plan.slug, cycle, amountMinor, plan.currency)
  const known = await remembered(key)
  if (known) return known
  const productId = await ensurePlanProduct(plan)
  const price = await paddle<{ id: string }>('POST', '/prices', {
    product_id: productId,
    description: `${plan.name} — ${cycle === 'annual' ? 'yearly' : 'monthly'}`,
    name: `${plan.name} (${cycle === 'annual' ? 'yearly' : 'monthly'})`,
    unit_price: { amount: String(amountMinor), currency_code: plan.currency.toUpperCase() },
    billing_cycle: { interval: cycle === 'annual' ? 'year' : 'month', frequency: 1 },
    tax_mode: 'account_setting',
    quantity: ONE_ONLY,
    custom_data: { slug: plan.slug, cycle },
  })
  return remember(key, price.id)
}

/** Which of our plans a Paddle price is (webhook side). */
export async function planForPaddlePrice(priceId: string | null | undefined): Promise<{ planId: number; cycle: Cycle } | null> {
  if (!priceId) return null
  const row = await db.paddleCatalog.findUnique({ where: { paddleId: priceId } })
  const m = row?.key.match(/^price:([^:]+):(monthly|annual):/)
  if (!m) return null
  const plan = await db.membershipPlan.findUnique({ where: { slug: m[1] }, select: { id: true } })
  return plan ? { planId: plan.id, cycle: m[2] as Cycle } : null
}

/** Get or create the user's Paddle customer (ctm_…). */
export async function ensurePaddleCustomer(userId: number): Promise<string> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, surname: true, paddleCustomerId: true },
  })
  if (user.paddleCustomerId) return user.paddleCustomerId
  let id: string | null = null
  try {
    const customer = await paddle<{ id: string }>('POST', '/customers', {
      email: user.email,
      name: `${user.name} ${user.surname}`.trim() || undefined,
      custom_data: { userId: String(user.id) },
    })
    id = customer.id
  } catch (err) {
    // The email already has a Paddle customer (an earlier attempt, or the
    // sandbox reused): find it rather than fail the coach's checkout.
    if (!(err instanceof PaddleError) || err.status !== 409) throw err
    id = err.message.match(/ctm_[a-z0-9]+/i)?.[0] ?? null
    if (!id) {
      const found = await paddle<Array<{ id: string }>>('GET', `/customers?email=${encodeURIComponent(user.email)}`)
      id = found?.[0]?.id ?? null
    }
    if (!id) throw err
  }
  await db.user.update({ where: { id: userId }, data: { paddleCustomerId: id } })
  return id
}

/**
 * Where the browser goes to pay: our /checkout page, which opens Paddle's
 * overlay for this transaction (`_ptxn` is the name Paddle.js looks for).
 * `to` is where the page sends the buyer after paying — always our own path.
 */
export function checkoutUrl(transactionId: string, to: string): string {
  const safeTo = to.startsWith('/') && !to.startsWith('//') ? to : '/'
  return `${env.FRONTEND_URL}/checkout?_ptxn=${encodeURIComponent(transactionId)}&to=${encodeURIComponent(safeTo)}`
}

/** A ready-to-pay transaction for a plan. Returns its id (txn_…). */
export async function createPlanTransaction(params: {
  userId: number
  planId: number
  cycle: Cycle
  priceId: string
}): Promise<string> {
  const customerId = await ensurePaddleCustomer(params.userId)
  const txn = await paddle<{ id: string }>('POST', '/transactions', {
    items: [{ price_id: params.priceId, quantity: 1 }],
    customer_id: customerId,
    collection_mode: 'automatic',
    custom_data: { kind: 'subscription', userId: String(params.userId), planId: String(params.planId), cycle: params.cycle },
  })
  return txn.id
}

export interface PaddleSubscription {
  id: string
  status: 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled'
  customer_id: string
  custom_data?: Record<string, string> | null
  items: Array<{ price: { id: string }; quantity?: number }>
  billing_cycle?: { interval: 'day' | 'week' | 'month' | 'year'; frequency: number } | null
  current_billing_period?: { starts_at: string; ends_at: string } | null
  scheduled_change?: { action: 'cancel' | 'pause' | 'resume'; effective_at: string } | null
  started_at?: string | null
}

export async function getSubscription(id: string): Promise<PaddleSubscription> {
  return paddle<PaddleSubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`)
}

/**
 * Move a paying coach to another plan on the SAME subscription — two live
 * subscriptions would bill twice.
 *
 * P4 (owner, 26 Nov 2026: "now"): every plan change is charged at once — the
 * new plan's price for the rest of the period, less what is left of the old
 * one (prorated_immediately). A downgrade leaves Paddle credit that comes off
 * the next bills. If the card fails, nothing changes (prevent_change). This is
 * also the only mode Paddle allows for monthly ↔ yearly (PADDLE-CYCLE).
 */
export async function changePlan(subscriptionId: string, priceId: string, meta: { userId: number; planId: number; cycle: Cycle }) {
  return paddle<PaddleSubscription>('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    items: [{ price_id: priceId, quantity: 1 }],
    proration_billing_mode: 'prorated_immediately',
    on_payment_failure: 'prevent_change',
    custom_data: { userId: String(meta.userId), planId: String(meta.planId), cycle: meta.cycle },
  })
}

/** Cancel: at the end of the paid period (coach), or now (Admin refund). */
export async function cancelSubscription(subscriptionId: string, when: 'next_billing_period' | 'immediately') {
  return paddle<PaddleSubscription>('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { effective_from: when })
}

/** Take back a cancel that hasn't happened yet. */
export async function undoScheduledCancel(subscriptionId: string) {
  return paddle<PaddleSubscription>('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, { scheduled_change: null })
}

/** When a cancelled-at-period-end plan stops. */
export function accessEndsAt(sub: Pick<PaddleSubscription, 'scheduled_change' | 'current_billing_period'>): Date | null {
  const at = sub.scheduled_change?.action === 'cancel' ? sub.scheduled_change.effective_at : sub.current_billing_period?.ends_at
  return at ? new Date(at) : null
}

/** Paddle's own page: card, invoices, cancel, EU withdrawal. */
export async function portalUrl(customerId: string, subscriptionId?: string | null): Promise<string> {
  const session = await paddle<{ urls: { general: { overview: string } } }>(
    'POST',
    `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
    subscriptionId ? { subscription_ids: [subscriptionId] } : {},
  )
  return session.urls.general.overview
}

export interface PaddleTransaction {
  id: string
  status: string
  customer_id: string | null
  subscription_id: string | null
  origin?: string
  billed_at: string | null
  created_at: string
  currency_code: string
  custom_data?: Record<string, string> | null
  details?: { totals?: { total?: string; tax?: string; grand_total?: string; subtotal?: string; discount?: string } }
  billing_period?: { starts_at: string; ends_at: string } | null
}

/** A subscription's completed payments, oldest first. */
export async function completedTransactions(subscriptionId: string): Promise<PaddleTransaction[]> {
  const list = await paddle<PaddleTransaction[]>(
    'GET',
    `/transactions?subscription_id=${encodeURIComponent(subscriptionId)}&status=completed&order_by=billed_at[ASC]&per_page=100`,
  )
  return list ?? []
}

/** What a transaction actually took, excluding tax (never ours), in minor units. */
export function netOfTax(txn: Pick<PaddleTransaction, 'details'>): number {
  const t = txn.details?.totals
  return Math.max(0, Number(t?.total ?? 0) - Number(t?.tax ?? 0))
}

/** Ask Paddle to refund a whole transaction. Most refunds need Paddle's approval first. */
export async function refundTransaction(transactionId: string, reason: string) {
  return paddle<{ id: string; status: string }>('POST', '/adjustments', {
    action: 'refund',
    transaction_id: transactionId,
    type: 'full',
    reason: reason.slice(0, 250) || 'Refund',
  })
}

/**
 * Referral free months for a coach paying through Paddle: a discount on the
 * coming invoices. Monthly plan → 100% off the next N invoices. Yearly plan →
 * the monthly price × N off the next invoice (Stripe gave the same as a credit).
 */
export async function giveFreeMonths(params: {
  subscriptionId: string
  months: number
  cycle: Cycle | null
  monthlyPence: number
  currency: string
}): Promise<void> {
  const { subscriptionId, months, cycle, monthlyPence, currency } = params
  if (months <= 0) return
  const description = `TactiCoach referral reward — ${months} free month${months === 1 ? '' : 's'}`
  const discount =
    cycle === 'annual'
      ? await paddle<{ id: string }>('POST', '/discounts', {
          type: 'flat',
          amount: String(monthlyPence * months),
          currency_code: currency.toUpperCase(),
          description,
          recur: false,
          enabled_for_checkout: false,
        })
      : await paddle<{ id: string }>('POST', '/discounts', {
          type: 'percentage',
          amount: '100',
          description,
          recur: true,
          maximum_recurring_intervals: months,
          enabled_for_checkout: false,
        })
  await paddle('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    discount: { id: discount.id, effective_from: 'next_billing_period' },
  })
}
