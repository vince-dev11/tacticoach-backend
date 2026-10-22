// BILLING (20 Oct 2026) · the Stripe catalogue, made from our own plans table.
//
// Going live must be "paste the keys, done": no products to create by hand in
// the Stripe dashboard. So each plan's price is found — or created the first
// time it is needed — by a lookup key that encodes the plan, the cycle and the
// AMOUNT. Change a price in our plans table and the next checkout creates a new
// Stripe price (old subscribers keep theirs, as Stripe intends); nothing in
// Stripe ever has to be edited by hand.
//
// Real Prices (rather than inline price_data on every checkout) are what make
// an in-place plan change possible: a Basic coach moving to Pro keeps ONE
// subscription, prorated, instead of being billed for two.

import type Stripe from 'stripe'
import { stripe } from '../../config/stripe.js'
import { env } from '../../config/env.js'

export interface CatalogPlan {
  id: number
  slug: string
  name: string
  description: string | null
  currency: string
}

/** Pence from a decimal price as stored in the plans table ("8.99" → 899). */
export function toMinorUnits(price: unknown): number {
  return Math.round(Number(price) * 100)
}

/** The lookup key for one plan, cycle and amount. Stable, so it is found again. */
export function lookupKeyFor(slug: string, cycle: 'monthly' | 'annual', amount: number, currency: string): string {
  return `tacticoach_${slug}_${cycle}_${amount}_${currency.toLowerCase()}`
}

/** The Stripe Price for this plan and cycle, created on first use. */
export async function ensurePrice(plan: CatalogPlan, cycle: 'monthly' | 'annual', amount: number): Promise<string> {
  const s = stripe()
  const lookup_key = lookupKeyFor(plan.slug, cycle, amount, plan.currency)
  const found = await s.prices.list({ lookup_keys: [lookup_key], active: true, limit: 1 })
  if (found.data[0]) return found.data[0].id

  const product = await ensureProduct(plan)
  const price = await s.prices.create({
    product,
    currency: plan.currency.toLowerCase(),
    unit_amount: amount,
    recurring: { interval: cycle === 'annual' ? 'year' : 'month' },
    lookup_key,
    // A second process racing us to the same key gets this price, not a duplicate.
    transfer_lookup_key: true,
    metadata: { planId: String(plan.id), planSlug: plan.slug, cycle },
  })
  return price.id
}

async function ensureProduct(plan: CatalogPlan): Promise<string> {
  const s = stripe()
  const found = await s.products.search({ query: `metadata['tacticoachPlan']:'${plan.slug}' AND active:'true'`, limit: 1 })
    .catch(() => ({ data: [] as Stripe.Product[] }))
  if (found.data[0]) return found.data[0].id
  const product = await s.products.create({
    name: `TactiCoach ${plan.name}`,
    // RBI cross-border rules for Indian Stripe accounts need a clear
    // description of the service sold; harmless anywhere else.
    description: plan.description ?? 'TactiCoach coaching software subscription (digital service)',
    metadata: { tacticoachPlan: plan.slug },
  })
  return product.id
}

let portalConfigId: string | null = null

/**
 * The Customer Portal configuration (update card, invoices, cancel at period
 * end, billing details). Stripe refuses a portal session until a configuration
 * exists, and saving one in the dashboard is exactly the manual step we are
 * avoiding — so it is created once through the API and found again by its
 * metadata.
 */
export async function ensurePortalConfiguration(): Promise<string> {
  if (portalConfigId) return portalConfigId
  const s = stripe()
  const list = await s.billingPortal.configurations.list({ active: true, limit: 20 })
  const ours = list.data.find((c) => c.metadata?.app === 'tacticoach')
  if (ours) return (portalConfigId = ours.id)
  const created = await s.billingPortal.configurations.create({
    business_profile: {
      headline: 'TactiCoach — manage your plan',
      privacy_policy_url: `${env.FRONTEND_URL}/privacy`,
      terms_of_service_url: `${env.FRONTEND_URL}/terms`,
    },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['name', 'email', 'address'] },
      // Cancelling keeps access to the end of the period that was paid for.
      subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'unused', 'switched_service', 'other'] } },
    },
    metadata: { app: 'tacticoach' },
  })
  return (portalConfigId = created.id)
}

/** For tests: forget the cached configuration id. */
export function _resetPortalCache(): void {
  portalConfigId = null
}

/** 'test' or 'live', from the secret key; null when Stripe is not configured. */
export function stripeMode(key: string | undefined = env.STRIPE_SECRET_KEY): 'test' | 'live' | null {
  if (!key) return null
  return key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : 'test'
}
