import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'

describe('GET /api/membership/plans', () => {
  it('is public and returns active plans in order', async () => {
    const app = await getApp()
    dbMock.membershipPlan.findMany.mockResolvedValue([
      { id: 1, name: 'Pro', slug: 'pro' },
      { id: 2, name: 'Pro AI', slug: 'pro-ai' },
    ] as never)

    const res = await app.inject({ method: 'GET', url: '/api/membership/plans' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(2)
    expect(dbMock.membershipPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    )
  })
})

describe('GET /api/membership/my', () => {
  it('requires auth', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/membership/my' })
    expect(res.statusCode).toBe(401)
  })

  it('returns the subscription with its plan', async () => {
    const app = await getApp()
    dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)

    const res = await app.inject({
      method: 'GET',
      url: '/api/membership/my',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().plan.slug).toBe('pro-ai')
  })

  it('returns null when the user has no subscription', async () => {
    const app = await getApp()
    dbMock.userSubscription.findUnique.mockResolvedValue(null)

    const res = await app.inject({
      method: 'GET',
      url: '/api/membership/my',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body === '' || res.json() === null).toBe(true)
  })
})

describe('GET /api/membership/entitlements', () => {
  it('reports editorAccess for the authenticated user', async () => {
    const app = await getApp()
    dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue(null)

    const res = await app.inject({
      method: 'GET',
      url: '/api/membership/entitlements',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().editorAccess).toBe(true)
  })
})

describe('POST /api/membership/checkout', () => {
  it('returns 503 when Stripe is not configured', async () => {
    const app = await getApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/membership/checkout',
      headers: authHeaders(await accessToken()),
      payload: { planSlug: 'pro-ai', cycle: 'monthly' },
    })
    expect(res.statusCode).toBe(503)
  })
})

describe('PATCH /api/membership/cancel', () => {
  it('404s when there is nothing to cancel', async () => {
    const app = await getApp()
    dbMock.userSubscription.findUnique.mockResolvedValue(null)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/membership/cancel',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(404)
  })

  it('marks the subscription cancelled', async () => {
    const app = await getApp()
    dbMock.userSubscription.findUnique.mockResolvedValue(
      activeSubscription({ paymentProvider: null, providerSubscriptionId: null }) as never,
    )
    dbMock.userSubscription.update.mockResolvedValue(
      activeSubscription({ status: 'cancelled', cancelledAt: new Date() }) as never,
    )

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/membership/cancel',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('cancelled')
    expect(dbMock.userSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
    )
  })
})

describe('POST /api/webhooks/stripe', () => {
  it('returns 503 when Stripe is not configured', async () => {
    const app = await getApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(503)
  })
})
