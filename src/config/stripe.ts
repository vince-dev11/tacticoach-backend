import Stripe from 'stripe'
import { env } from './env.js'

let client: Stripe | null = null

/** Lazy Stripe client; throws a 503 if billing isn't configured. */
export function stripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    const err = new Error('Billing is not configured on this server') as Error & { statusCode: number }
    err.statusCode = 503
    throw err
  }
  if (!client) client = new Stripe(env.STRIPE_SECRET_KEY)
  return client
}

export function stripeConfigured(): boolean {
  return !!env.STRIPE_SECRET_KEY
}
