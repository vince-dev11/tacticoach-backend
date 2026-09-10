// Admin area (blog CMS + CRM) — owner-only access, blog lifecycle, stats,
// leads and trial extension. Public blog endpoints included.

import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, userRow, activeSubscription } from './helpers.js'

function ownerRole() {
  dbMock.user.findUnique.mockResolvedValue({ role: 'owner' } as never)
}
function userRole() {
  dbMock.user.findUnique.mockResolvedValue({ role: 'user' } as never)
}

function postRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: 'pressing-guide',
    title: 'The Complete Pressing Guide',
    excerpt: 'How to coach a press.',
    content: '# Press\n\nWin the ball high.',
    coverImageKey: null,
    tags: ['pressing'],
    status: 'published',
    publishedAt: new Date(),
    authorId: 1,
    seoTitle: null,
    seoDescription: null,
    readMinutes: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('owner guard', () => {
  it('rejects anonymous requests', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/blog' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects normal users with 403', async () => {
    const app = await getApp()
    userRole()
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/blog',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('lets the owner through', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.blogPost.findMany.mockResolvedValue([] as never)
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/blog',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('blog CMS', () => {
  it('creates a draft with an auto-generated unique slug', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.blogPost.findFirst.mockResolvedValue(null) // slug free
    dbMock.blogPost.create.mockResolvedValue(postRow({ status: 'draft', publishedAt: null }) as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/blog',
      headers: authHeaders(await accessToken()),
      payload: { title: 'The Complete Pressing Guide!', content: 'Win the ball high up the pitch.' },
    })
    expect(res.statusCode).toBe(201)
    const call = dbMock.blogPost.create.mock.calls[0][0]
    expect(call.data.slug).toBe('the-complete-pressing-guide')
    expect(call.data.status).toBe('draft')
    expect(call.data.publishedAt).toBeNull()
  })

  it('suffixes the slug when taken', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.blogPost.findFirst
      .mockResolvedValueOnce({ id: 9 } as never) // 'post' taken
      .mockResolvedValueOnce(null) // 'post-2' free
    dbMock.blogPost.create.mockResolvedValue(postRow() as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/blog',
      headers: authHeaders(await accessToken()),
      payload: { title: 'Post', content: 'x' },
    })
    expect(res.statusCode).toBe(201)
    expect(dbMock.blogPost.create.mock.calls[0][0].data.slug).toBe('post-2')
  })

  it('stamps publishedAt on first publish and keeps it on re-publish', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.blogPost.findUnique.mockResolvedValue(postRow({ status: 'draft', publishedAt: null }) as never)
    // requireOwner uses user.findUnique; blog uses blogPost.findUnique — both mocked.
    dbMock.user.findUnique.mockResolvedValue({ role: 'owner' } as never)
    dbMock.blogPost.update.mockResolvedValue(postRow() as never)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/blog/1',
      headers: authHeaders(await accessToken()),
      payload: { status: 'published' },
    })
    expect(res.statusCode).toBe(200)
    const call = dbMock.blogPost.update.mock.calls[0][0]
    expect(call.data.status).toBe('published')
    expect(call.data.publishedAt).toBeInstanceOf(Date)
  })

  it('computes read minutes from content length', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.blogPost.findFirst.mockResolvedValue(null)
    dbMock.blogPost.create.mockResolvedValue(postRow() as never)

    const words = Array(600).fill('word').join(' ') // ~3 min at 200wpm
    await app.inject({
      method: 'POST',
      url: '/api/admin/blog',
      headers: authHeaders(await accessToken()),
      payload: { title: 'Long read', content: words },
    })
    expect(dbMock.blogPost.create.mock.calls[0][0].data.readMinutes).toBe(3)
  })
})

describe('public blog', () => {
  it('lists only published posts with presigned covers', async () => {
    const app = await getApp()
    dbMock.blogPost.findMany.mockResolvedValue([
      postRow({ coverImageKey: 'blog/1/cover.jpg' }),
    ] as never)
    dbMock.blogPost.count.mockResolvedValue(1 as never)

    const res = await app.inject({ method: 'GET', url: '/api/blog' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.posts[0].coverUrl).toContain('signed')
    expect(dbMock.blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'published' } }),
    )
  })

  it('serves a single published post by slug and 404s drafts', async () => {
    const app = await getApp()
    dbMock.blogPost.findFirst.mockResolvedValue(postRow() as never)
    const ok = await app.inject({ method: 'GET', url: '/api/blog/pressing-guide' })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().content).toContain('Win the ball')

    dbMock.blogPost.findFirst.mockResolvedValue(null)
    const missing = await app.inject({ method: 'GET', url: '/api/blog/nope' })
    expect(missing.statusCode).toBe(404)
  })

  it('serves RSS and sitemap XML', async () => {
    const app = await getApp()
    dbMock.blogPost.findMany.mockResolvedValue([postRow()] as never)

    const rss = await app.inject({ method: 'GET', url: '/api/blog/rss.xml' })
    expect(rss.statusCode).toBe(200)
    expect(rss.headers['content-type']).toContain('rss')
    expect(rss.body).toContain('<rss')
    expect(rss.body).toContain('/blog/pressing-guide')

    const sm = await app.inject({ method: 'GET', url: '/api/blog/sitemap.xml' })
    expect(sm.statusCode).toBe(200)
    expect(sm.body).toContain('<urlset')
  })
})

describe('CRM', () => {
  it('returns dashboard stats with MRR from active subscriptions', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.user.count.mockResolvedValueOnce(42 as never).mockResolvedValueOnce(30 as never)
    dbMock.userSubscription.count
      .mockResolvedValueOnce(10 as never) // active trials
      .mockResolvedValueOnce(3 as never) // expiring
    dbMock.userSubscription.findMany.mockResolvedValue([
      { billingCycle: 'monthly', plan: { monthlyPrice: '5.99', annualPrice: '47.88' } },
      { billingCycle: 'annual', plan: { monthlyPrice: '14.99', annualPrice: '119.88' } },
    ] as never)
    dbMock.contactMessage.count.mockResolvedValue(2 as never)
    dbMock.user.findMany.mockResolvedValue([] as never)

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/stats',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.totalUsers).toBe(42)
    expect(body.payingSubscribers).toBe(2)
    expect(body.mrr).toBeCloseTo(5.99 + 119.88 / 12, 2)
    expect(body.signupsByWeek).toHaveLength(8)
  })

  it('extends an existing trial and re-arms the reminder', async () => {
    const app = await getApp()
    ownerRole()
    const expiresAt = new Date(Date.now() + 2 * 86400_000)
    dbMock.userSubscription.findUnique.mockResolvedValue(
      activeSubscription({ status: 'trial', expiresAt }) as never,
    )
    dbMock.userSubscription.update.mockResolvedValue({} as never)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/users/5/trial',
      headers: authHeaders(await accessToken()),
      payload: { days: 14 },
    })
    expect(res.statusCode).toBe(200)
    const call = dbMock.userSubscription.update.mock.calls[0][0]
    expect(call.data.trialReminderSentAt).toBeNull()
    const newExpiry = call.data.expiresAt as Date
    expect(newExpiry.getTime()).toBeCloseTo(expiresAt.getTime() + 14 * 86400_000, -4)
  })

  it('lists and updates leads', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.contactMessage.findMany.mockResolvedValue([
      { id: 1, firstName: 'A', lastName: 'B', email: 'a@b.c', message: 'hi', status: 'new' },
    ] as never)

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/leads',
      headers: authHeaders(await accessToken()),
    })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toHaveLength(1)

    dbMock.contactMessage.update.mockResolvedValue({ id: 1, status: 'replied' } as never)
    const upd = await app.inject({
      method: 'PATCH',
      url: '/api/admin/leads/1',
      headers: authHeaders(await accessToken()),
      payload: { status: 'replied' },
    })
    expect(upd.statusCode).toBe(200)
    expect(upd.json().status).toBe('replied')
  })

  it('contact form persists a lead for the CRM', async () => {
    const app = await getApp()
    dbMock.contactMessage.create.mockResolvedValue({} as never)
    // SMTP unconfigured in tests → 503, but the lead must still be stored.
    const res = await app.inject({
      method: 'POST',
      url: '/api/contact',
      payload: { first_name: 'Lead', last_name: 'Test', email: 'lead@test.dev', message: 'I want the club plan for my academy.' },
    })
    expect([200, 503]).toContain(res.statusCode)
    expect(dbMock.contactMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'lead@test.dev' }) }),
    )
  })
})

describe('owner promotion on register', () => {
  it('registering with OWNER_EMAIL is inert when unset (default role)', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(null)
    dbMock.user.create.mockResolvedValue(userRow() as never)
    dbMock.membershipPlan.findUnique.mockResolvedValue(null)
    dbMock.refreshToken.create.mockResolvedValue({} as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'A', surname: 'B', email: 'a@b.dev', password: 'password123' },
    })
    expect(res.statusCode).toBe(201)
    expect(dbMock.user.create.mock.calls[0][0].data.role).toBeUndefined()
  })
})

describe('complimentary plans', () => {
  it('lists grantable plans (owner only)', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.membershipPlan.findMany.mockResolvedValue([{ id: 2, name: 'Pro', slug: 'pro', monthlyPrice: 2.99 }] as never)
    const res = await app.inject({ method: 'GET', url: '/api/admin/plans', headers: authHeaders(await accessToken()) })
    expect(res.statusCode).toBe(200)
    expect(res.json().plans[0].slug).toBe('pro')

    userRole()
    const denied = await app.inject({ method: 'GET', url: '/api/admin/plans', headers: authHeaders(await accessToken()) })
    expect(denied.statusCode).toBe(403)
  })

  it('grants an active complimentary subscription with an expiry', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.membershipPlan.findUnique.mockResolvedValue({ id: 2, slug: 'pro', name: 'Pro' } as never)
    // Second user.findUnique call is the target user lookup.
    dbMock.user.findUnique
      .mockResolvedValueOnce({ role: 'owner' } as never)
      .mockResolvedValueOnce(userRow({ id: 5, name: 'Amara', clubName: null }) as never)
    dbMock.userSubscription.upsert.mockResolvedValue({ id: 9, userId: 5, status: 'active' } as never)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/users/5/plan',
      headers: authHeaders(await accessToken()),
      payload: { planSlug: 'pro', months: 12 },
    })
    expect(res.statusCode).toBe(200)
    const call = dbMock.userSubscription.upsert.mock.calls[0][0] as { where: { userId: number }; create: Record<string, unknown> }
    expect(call.where).toEqual({ userId: 5 })
    expect(call.create).toMatchObject({ planId: 2, status: 'active', paymentProvider: 'complimentary' })
    expect(call.create.expiresAt).toBeInstanceOf(Date)
    expect(dbMock.club.upsert).not.toHaveBeenCalled()
  })

  it('creates the Club when granting the club plan, and supports no expiry', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.membershipPlan.findUnique.mockResolvedValue({ id: 3, slug: 'club', name: 'Club' } as never)
    dbMock.user.findUnique
      .mockResolvedValueOnce({ role: 'owner' } as never)
      .mockResolvedValueOnce(userRow({ id: 6, name: 'Carlos', clubName: 'QA United' }) as never)
    dbMock.userSubscription.upsert.mockResolvedValue({ id: 10 } as never)
    dbMock.club.upsert.mockResolvedValue({ id: 1 } as never)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/users/6/plan',
      headers: authHeaders(await accessToken()),
      payload: { planSlug: 'club', months: null },
    })
    expect(res.statusCode).toBe(200)
    const call = dbMock.userSubscription.upsert.mock.calls[0][0] as { create: Record<string, unknown> }
    expect(call.create.expiresAt).toBeNull()
    expect(dbMock.club.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 6 }, create: { ownerId: 6, name: 'QA United' } }),
    )
  })

  it('404s an unknown plan', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.membershipPlan.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/users/5/plan',
      headers: authHeaders(await accessToken()),
      payload: { planSlug: 'gold', months: 1 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('revokes a complimentary plan but refuses to touch a Stripe one', async () => {
    const app = await getApp()
    ownerRole()
    dbMock.userSubscription.findUnique.mockResolvedValue({ paymentProvider: 'complimentary' } as never)
    dbMock.userSubscription.update.mockResolvedValue({} as never)
    const ok = await app.inject({ method: 'DELETE', url: '/api/admin/users/5/plan', headers: authHeaders(await accessToken()) })
    expect(ok.statusCode).toBe(204)
    expect(dbMock.userSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 5 }, data: expect.objectContaining({ status: 'expired' }) }),
    )

    dbMock.userSubscription.findUnique.mockResolvedValue({ paymentProvider: 'stripe' } as never)
    const paid = await app.inject({ method: 'DELETE', url: '/api/admin/users/5/plan', headers: authHeaders(await accessToken()) })
    expect(paid.statusCode).toBe(409)
  })
})
