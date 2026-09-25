// Admin → Analytics: owner-only, every source optional, our own DB counts
// always present, GA4 rows shaped into the country/feature views.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dbMock } from './setup.js'
import { accessToken, authHeaders, getApp } from './helpers.js'
import { isoWeek } from '../src/modules/admin/analytics/analytics.service.js'
import { clearAnalyticsCache } from '../src/modules/admin/analytics/sources.js'
import { generateKeyPairSync } from 'node:crypto'
import { env } from '../src/config/env.js'

const owner = async () => authHeaders(await accessToken(1))

beforeEach(() => {
  clearAnalyticsCache()
  dbMock.user.findUnique.mockResolvedValue({ role: 'owner' } as never)
  // Empty tables by default.
  for (const m of ['user', 'canvasBoard', 'drillSheet', 'trainingSession', 'ebook', 'playerNote', 'userSubscription'] as const) {
    ;(dbMock[m].findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([])
  }
  dbMock.emailLog.count.mockResolvedValue(0)
  dbMock.contactMessage.count.mockResolvedValue(0)
})

describe('access', () => {
  it('is closed to non-owners', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue({ role: 'user' } as never)
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/status', headers: await owner() })
    expect(res.statusCode).toBe(403)
  })

  it('rejects an unknown range', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/countries?range=1y', headers: await owner() })
    expect(res.statusCode).toBe(422)
  })
})

describe('without any keys', () => {
  it('reports every source as unconfigured, never as an error', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/status', headers: await owner() })
    expect(res.statusCode).toBe(200)
    expect(res.json().sources).toEqual({ ga4: { state: 'unconfigured' }, posthog: { state: 'unconfigured' }, sentry: { state: 'unconfigured' } })
  })

  it('features still carry our own database trend', async () => {
    const day = (d: number) => ({ createdAt: new Date(Date.UTC(2026, 8, d)) })
    dbMock.canvasBoard.findMany.mockResolvedValue([day(21), day(22), day(24)] as never)
    dbMock.user.findMany.mockResolvedValue([day(24)] as never)
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/features?range=30d', headers: await owner() })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ga4.status.state).toBe('unconfigured')
    expect(body.db.totals).toMatchObject({ boards: 3, signups: 1, sheets: 0 })
    const wk = body.db.weekly.find((w: { week: string }) => w.week === '2026-W39')
    expect(wk.counts).toEqual({ boards: 3, signups: 1 })
    expect(body.groups.board).toContain('board_exported')
  })

  it('health still counts failed emails from our log', async () => {
    dbMock.emailLog.count.mockResolvedValueOnce(120).mockResolvedValueOnce(4)
    dbMock.contactMessage.count.mockResolvedValue(2)
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/health?range=7d', headers: await owner() })
    expect(res.json()).toMatchObject({ sentry: { status: { state: 'unconfigured' } }, db: { emailsSent: 120, emailsFailed: 4, leadsNew: 2 } })
  })
})

describe('with GA4 configured', () => {
  // A throwaway RSA key so the service-account JWT can be signed for real.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

  const fetchMock = vi.fn()

  beforeEach(() => {
    process.env.GA4_PROPERTY_ID = '123456'
    process.env.GA4_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'sa@test.iam', private_key: pem })
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  it('shapes GA4 rows into the countries table with totals', async () => {
    // env is parsed at import; patch the live object the module reads.
    Object.assign(env, { GA4_PROPERTY_ID: '123456', GA4_SERVICE_ACCOUNT_JSON: process.env.GA4_SERVICE_ACCOUNT_JSON })

    const gaRows = (rows: { d: string[]; m: number[] }[]) =>
      new Response(JSON.stringify({ rows: rows.map((r) => ({ dimensionValues: r.d.map((value) => ({ value })), metricValues: r.m.map((v) => ({ value: String(v) })) })) }), { status: 200 })

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
      const body = JSON.parse(String(init?.body))
      const dims = body.dimensions.map((d: { name: string }) => d.name).join(',')
      if (dims === 'countryId,country') return gaRows([{ d: ['GB', 'United Kingdom'], m: [120, 40, 300] }, { d: ['DE', 'Germany'], m: [30, 10, 55] }])
      if (dims === 'countryId,eventName') return gaRows([{ d: ['GB', 'account_registered'], m: [12] }, { d: ['GB', 'purchase'], m: [3] }, { d: ['DE', 'begin_checkout'], m: [2] }])
      return gaRows([])
    })

    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/countries?range=30d', headers: await owner() })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status.state).toBe('ok')
    expect(body.data.rows[0]).toEqual({ code: 'GB', name: 'United Kingdom', users: 120, newUsers: 40, sessions: 300, signups: 12, checkouts: 0, purchases: 3 })
    expect(body.data.rows[1]).toMatchObject({ code: 'DE', checkouts: 2 })
    expect(body.data.totals).toMatchObject({ users: 150, purchases: 3 })

    // The token exchange happened with a signed JWT, and the report went to the property.
    const tokenCall = fetchMock.mock.calls.find(([u]) => String(u).includes('oauth2'))!
    expect(String(tokenCall[1]!.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('properties/123456:runReport'))).toBe(true)

    // Second call within 15 minutes: served from cache, no new fetches.
    const before = fetchMock.mock.calls.length
    await app.inject({ method: 'GET', url: '/api/admin/analytics/countries?range=30d', headers: await owner() })
    expect(fetchMock.mock.calls.length).toBe(before)

    Object.assign(env, { GA4_PROPERTY_ID: undefined, GA4_SERVICE_ACCOUNT_JSON: undefined })
    vi.unstubAllGlobals()
  })

  it('a failing source becomes state=error with a reason, not a 500', async () => {
    Object.assign(env, { GA4_PROPERTY_ID: '123456', GA4_SERVICE_ACCOUNT_JSON: process.env.GA4_SERVICE_ACCOUNT_JSON })
    fetchMock.mockResolvedValue(new Response('permission denied', { status: 403 }))
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/countries?range=7d', headers: await owner() })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toMatchObject({ state: 'error' })
    expect(res.json().status.detail).toContain('403')
    Object.assign(env, { GA4_PROPERTY_ID: undefined, GA4_SERVICE_ACCOUNT_JSON: undefined })
    vi.unstubAllGlobals()
  })
})

describe('isoWeek', () => {
  it('follows ISO 8601 (weeks start Monday, week 1 holds 4 January)', () => {
    expect(isoWeek(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01')
    expect(isoWeek(new Date('2026-09-25T00:00:00Z'))).toBe('2026-W39')
    expect(isoWeek(new Date('2027-01-03T00:00:00Z'))).toBe('2026-W53')
  })
})

describe('performance', () => {
  it('reports process vitals, a DB ping and per-route timings from real traffic', async () => {
    const { resetRequestStats } = await import('../src/lib/request-stats.js')
    resetRequestStats()
    const app = await getApp()
    dbMock.$queryRaw.mockResolvedValue([{ 1: 1 }] as never)
    // Generate some traffic first.
    for (let i = 0; i < 4; i++) await app.inject({ method: 'GET', url: '/health' })
    await app.inject({ method: 'GET', url: '/api/users/me' }) // 401

    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/performance', headers: await owner() })
    expect(res.statusCode).toBe(200)
    const v = res.json()
    expect(v.uptimeSeconds).toBeGreaterThanOrEqual(0)
    expect(v.memory.rssMb).toBeGreaterThan(0)
    expect(v.db).toMatchObject({ ok: true })
    expect(v.requests.requests).toBeGreaterThanOrEqual(5)
    const health = v.requests.routes.find((r: { route: string }) => r.route === 'GET /health')
    expect(health.count).toBeGreaterThanOrEqual(4)
    expect(health.p95).toBeGreaterThanOrEqual(0)
    const me = v.requests.routes.find((r: { route: string }) => r.route === 'GET /api/users/me')
    expect(me.errors4xx).toBeGreaterThanOrEqual(1)
  })

  it('a database outage is reported, not thrown', async () => {
    const app = await getApp()
    dbMock.$queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED') as never)
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/performance', headers: await owner() })
    expect(res.statusCode).toBe(200)
    expect(res.json().db).toMatchObject({ ok: false, error: 'connect ECONNREFUSED' })
  })

  it('CORS preflights are cacheable for two hours', async () => {
    const app = await getApp()
    const res = await app.inject({
      method: 'OPTIONS', url: '/api/users/me',
      headers: { origin: 'http://localhost:5280', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
    })
    expect(res.headers['access-control-max-age']).toBe('7200')
  })
})
