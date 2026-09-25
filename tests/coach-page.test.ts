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

// ---- Public-page details + contact relay (migration 34) ---------------------

import { vi, afterEach } from 'vitest'
import { isMailConfigured, sendMail } from '../src/config/mailer.js'

const mailConfigured = vi.mocked(isMailConfigured)
const sendMailMock = vi.mocked(sendMail)
afterEach(() => mailConfigured.mockReturnValue(false))

describe('public-page details', () => {
  it('saves coaching since / qualifications / philosophy / location / contact opt-in', async () => {
    const app = await getApp()
    mockLive()
    dbMock.user.findFirst.mockResolvedValue(null)
    dbMock.user.update.mockResolvedValue(coachRow() as never)
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/coach/me/branding',
      headers: authHeaders(await accessToken()),
      payload: { coachingSince: 2014, qualifications: 'UEFA B', philosophy: 'Brave on the ball', location: 'Leeds', contactEnabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(dbMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          coachingSince: 2014, coachQualifications: 'UEFA B', coachPhilosophy: 'Brave on the ball', coachLocation: 'Leeds', coachContactEnabled: true,
        }),
      }),
    )
  })

  it('rejects a coaching-since year in the future and an over-long philosophy', async () => {
    const app = await getApp()
    mockLive()
    const headers = authHeaders(await accessToken())
    const a = await app.inject({ method: 'PATCH', url: '/api/coach/me/branding', headers, payload: { coachingSince: new Date().getFullYear() + 1 } })
    expect(a.statusCode).toBe(422)
    const b = await app.inject({ method: 'PATCH', url: '/api/coach/me/branding', headers, payload: { philosophy: 'x'.repeat(201) } })
    expect(b.statusCode).toBe(422)
  })

  it('exposes the details on the public page but never the email', async () => {
    const app = await getApp()
    mockLive({ coachingSince: 2014, coachQualifications: 'UEFA B', coachPhilosophy: 'Brave', coachLocation: 'Leeds', coachContactEnabled: true })
    const res = await app.inject({ method: 'GET', url: '/api/coach/vince' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ coachingSince: 2014, qualifications: 'UEFA B', philosophy: 'Brave', location: 'Leeds', contactEnabled: true })
    expect(res.body).not.toContain('@')
  })
})

describe('POST /api/coach/:slug/contact', () => {
  const payload = { name: 'Priya Parent', email: 'priya@example.com', message: 'Do you run U9 sessions on Saturdays?' }

  // Order matters in this block: the limiter allows three an hour, and the
  // last test deliberately spends the budget. Validation runs before the
  // handler, so a rejected body still counts.
  it('rejects a filled honeypot', async () => {
    const app = await getApp()
    mockLive({ coachContactEnabled: true })
    const res = await app.inject({ method: 'POST', url: '/api/coach/vince/contact', payload: { ...payload, website: 'http://spam' } })
    expect(res.statusCode).toBe(422)
  })

  it('relays the message to the coach with the visitor as reply-to', async () => {
    const app = await getApp()
    mailConfigured.mockReturnValue(true)
    mockLive({ coachContactEnabled: true })
    const res = await app.inject({ method: 'POST', url: '/api/coach/vince/contact', payload })
    expect(res.statusCode).toBe(200)
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'coach@test.dev', replyTo: 'priya@example.com', kind: 'coach_contact' }),
    )
    expect(res.body).not.toContain('coach@test.dev')
  })

  it('403s when the coach has not opted in', async () => {
    const app = await getApp()
    mailConfigured.mockReturnValue(true)
    sendMailMock.mockClear()
    mockLive({ coachContactEnabled: false })
    const res = await app.inject({ method: 'POST', url: '/api/coach/vince/contact', payload })
    expect(res.statusCode).toBe(403)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('rate-limits the fourth attempt in an hour', async () => {
    const app = await getApp()
    mailConfigured.mockReturnValue(true)
    mockLive({ coachContactEnabled: true })
    expect((await app.inject({ method: 'POST', url: '/api/coach/vince/contact', payload })).statusCode).toBe(429)
  })
})
