// Coach branding — brand kit, slug rules, and the public coach page's
// auto-live gate (slug + enabled + active plan + something published).

import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, userRow, activeSubscription } from './helpers.js'

function coachRow(overrides: Record<string, unknown> = {}) {
  return userRow({
    role: 'user',
    coachSlug: 'vince',
    coachPhotoKey: 'coaches/1/photo.jpg',
    coachColor: '#fbbf24',
    coachBio: 'UEFA B. Building brave U13s.',
    coachTitle: 'Head coach U13',
    coachPageEnabled: true,
    coachLevel: 'academy',
    coachAgeGroup: 'u13',
    ownedClub: null,
    clubMembership: null,
    ...overrides,
  })
}

/** Plan active + N published items. */
function mockLive(row: Record<string, unknown> = {}, published = 2) {
  dbMock.user.findUnique.mockResolvedValue(coachRow(row) as never)
  dbMock.user.findFirst.mockResolvedValue(coachRow(row) as never)
  dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
  dbMock.canvasBoard.count.mockResolvedValue(published as never)
  dbMock.drillSheet.count.mockResolvedValue(0 as never)
  dbMock.canvasBoard.findMany.mockResolvedValue([
    { id: 7, title: 'High press', thumbnailKey: 'b/7.webp', videoKey: 'b/7.mp4', publishedAt: new Date(), tags: ['pressing'], ageGroup: 'u13', _count: { likes: 3 } },
  ] as never)
  dbMock.drillSheet.findMany.mockResolvedValue([] as never)
  dbMock.challengeSubmission.findMany.mockResolvedValue([] as never)
}

describe('GET /api/coach/:slug (public)', () => {
  it('serves a live coach page without auth', async () => {
    const app = await getApp()
    mockLive()
    const res = await app.inject({ method: 'GET', url: '/api/coach/vince' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.name).toBe('Test Coach')
    expect(body.slug).toBe('vince')
    expect(body.photoUrl).toContain('signed')
    expect(body.stats).toMatchObject({ boards: 1, sheets: 0, likes: 3, wins: 0 })
    expect(body.boards[0]).toMatchObject({ id: 7, category: 'pressing', ageGroup: 'u13', hasVideo: true })
  })

  it('404s when the page is switched off', async () => {
    const app = await getApp()
    mockLive({ coachPageEnabled: false })
    const res = await app.inject({ method: 'GET', url: '/api/coach/vince' })
    expect(res.statusCode).toBe(404)
  })

  it('404s when nothing is published yet', async () => {
    const app = await getApp()
    mockLive({}, 0)
    const res = await app.inject({ method: 'GET', url: '/api/coach/vince' })
    expect(res.statusCode).toBe(404)
  })

  it('goes dark when the plan lapses', async () => {
    const app = await getApp()
    mockLive()
    dbMock.userSubscription.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/coach/vince' })
    expect(res.statusCode).toBe(404)
  })

  it('404s unknown slugs', async () => {
    const app = await getApp()
    dbMock.user.findFirst.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/coach/nobody' })
    expect(res.statusCode).toBe(404)
  })
})

describe('brand kit (auth)', () => {
  it('requires auth', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/coach/me/branding' })
    expect(res.statusCode).toBe(401)
  })

  it('returns the kit with a go-live checklist and page URL when live', async () => {
    const app = await getApp()
    mockLive()
    const res = await app.inject({ method: 'GET', url: '/api/coach/me/branding', headers: authHeaders(await accessToken()) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.slug).toBe('vince')
    expect(body.status).toMatchObject({ live: true, hasSlug: true, enabled: true, planActive: true, publishedCount: 2 })
    expect(body.status.pageUrl).toContain('/coach/vince')
  })

  it('rejects reserved and malformed slugs', async () => {
    const app = await getApp()
    mockLive()
    const headers = authHeaders(await accessToken())
    const reserved = await app.inject({ method: 'PATCH', url: '/api/coach/me/branding', headers, payload: { slug: 'admin' } })
    expect(reserved.statusCode).toBe(422)
    const bad = await app.inject({ method: 'PATCH', url: '/api/coach/me/branding', headers, payload: { slug: 'Not A Slug!' } })
    expect(bad.statusCode).toBe(422)
  })

  it('409s a slug another coach already has', async () => {
    const app = await getApp()
    mockLive()
    dbMock.user.findFirst.mockResolvedValue({ id: 2 } as never)
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/coach/me/branding',
      headers: authHeaders(await accessToken()),
      payload: { slug: 'taken' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('saves colour/bio/title and returns the refreshed kit', async () => {
    const app = await getApp()
    mockLive()
    dbMock.user.findFirst.mockResolvedValue(null)
    dbMock.user.update.mockResolvedValue(coachRow() as never)
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/coach/me/branding',
      headers: authHeaders(await accessToken()),
      payload: { slug: 'vince', color: '#fbbf24', bio: 'Hello', title: 'Head coach U13', enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(dbMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ coachSlug: 'vince', coachColor: '#fbbf24', coachBio: 'Hello', coachTitle: 'Head coach U13', coachPageEnabled: true }),
      }),
    )
  })
})
