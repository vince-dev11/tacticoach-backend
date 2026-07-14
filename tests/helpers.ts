// Shared test helpers — app factory + auth token creation.

import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'

let app: FastifyInstance | null = null

/** Build (once) and return the app under test. */
export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp()
    await app.ready()
  }
  return app
}

/** Sign a valid access token for the given user id. */
export async function accessToken(userId = 1, email = 'coach@test.dev'): Promise<string> {
  const a = await getApp()
  return a.jwt.sign({ sub: userId, email }, { expiresIn: '15m' })
}

export function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` }
}

/** A minimal active-subscription row (as returned by prisma mocks). */
export function activeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    planId: 2,
    status: 'active',
    billingCycle: 'monthly',
    startedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 86400_000),
    cancelledAt: null,
    paymentProvider: 'stripe',
    providerSubscriptionId: 'sub_123',
    createdAt: new Date(),
    updatedAt: new Date(),
    plan: { id: 2, name: 'Pro AI', slug: 'pro-ai' },
    ...overrides,
  }
}

export function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Test',
    surname: 'Coach',
    email: 'coach@test.dev',
    phone: null,
    passwordHash: '$2a$12$invalidhashplaceholder000000000000000000000000000000',
    clubName: null,
    clubLogoUrl: null,
    clubLogoKey: null,
    instagramUrl: null,
    youtubeUrl: null,
    twitterUrl: null,
    facebookUrl: null,
    stripeCustomerId: null,
    emailVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}
