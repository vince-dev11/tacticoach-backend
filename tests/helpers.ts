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

/**
 * `db.user.findUnique` that honours `select`, the way Prisma does.
 *
 * The deep mock returns whatever row you hand it and ignores the query, which
 * is fine until one route calls findUnique twice for different reasons. The
 * login route reads the full row to check the password, then reads it again
 * through USER_SELECT to build the response; register checks for a duplicate
 * (expecting null) and then reads the new account back. With a plain
 * mockResolvedValue both calls get the same answer, so either the password
 * hash leaks into the response or the profile read comes back null — neither
 * of which is true of the real client.
 *
 * `whenNoSelect` covers the unselected call; selecting nothing otherwise
 * returns the whole row, which is also what Prisma does.
 */
export function mockUserFindUnique(
  mock: { mockImplementation: (fn: (args?: unknown) => unknown) => unknown },
  row: Record<string, unknown>,
  options: { whenNoSelect?: unknown } = {},
) {
  mock.mockImplementation((args?: unknown) => {
    const select = (args as { select?: Record<string, unknown> } | undefined)?.select
    if (!select) {
      return Promise.resolve('whenNoSelect' in options ? options.whenNoSelect : row)
    }
    const picked: Record<string, unknown> = {}
    for (const key of Object.keys(select)) {
      if (select[key]) picked[key] = row[key] ?? null
    }
    return Promise.resolve(picked)
  })
}
