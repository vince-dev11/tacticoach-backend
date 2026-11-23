// ACTIVITY-LOG (23 Nov 2026, owner: "what exactly users are doing … date
// wise"): coaches' activity recorded by the API (never players or parents),
// and the Admin → Analytics views built on it, for any period.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dbMock } from './setup.js'
import { accessToken, authHeaders, getApp } from './helpers.js'
import { clearAnalyticsCache, rangeOf } from '../src/modules/admin/analytics/sources.js'
import { daysOf, orderedFunnel, weekOf } from '../src/modules/admin/analytics/activity.service.js'
import { sweepActivity, ACTIVITY_KEEP_DAYS } from '../src/jobs/activity-retention.js'

const headers = async () => authHeaders(await accessToken(7))
const as = (accountType: string, role = 'user') =>
  dbMock.user.findUnique.mockResolvedValue({ id: 7, role, accountType } as never)

beforeEach(() => {
  clearAnalyticsCache()
  ;(dbMock.activityEvent.createMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
})

describe('POST /api/activity', () => {
  it('records a coach\'s batch: event, short values, the screen without ids', async () => {
    as('coach')
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/activity', headers: await headers(), payload: { events: [
      { event: 'board_exported', props: { quality: '4K', encoder: 'software', fps: 30 }, path: '/editor' },
      { event: 'page_viewed', path: '/sessions/:id' },
    ] } })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ recorded: 2 })
    const data = (dbMock.activityEvent.createMany.mock.calls[0][0] as { data: { userId: number; event: string; path: string | null; props?: unknown }[] }).data
    expect(data[0]).toMatchObject({ userId: 7, event: 'board_exported', path: '/editor', props: { quality: '4K', encoder: 'software', fps: 30 } })
    expect(data[1]).toMatchObject({ event: 'page_viewed', path: '/sessions/:id' })
  })

  it('the owner\'s own use is not recorded', async () => {
    as('coach', 'owner')
    dbMock.activityEvent.createMany.mockClear()
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/activity', headers: await headers(), payload: { events: [{ event: 'board_saved' }] } })
    expect(res.json()).toEqual({ recorded: 0 })
    expect(dbMock.activityEvent.createMany).not.toHaveBeenCalled()
  })

  it('a club account is recorded too', async () => {
    as('club')
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/activity', headers: await headers(), payload: { events: [{ event: 'board_saved' }] } })
    expect(res.json()).toEqual({ recorded: 1 })
  })

  it('players and parents are never recorded', async () => {
    for (const t of ['player', 'parent']) {
      as(t)
      dbMock.activityEvent.createMany.mockClear()
      const app = await getApp()
      const res = await app.inject({ method: 'POST', url: '/api/activity', headers: await headers(), payload: { events: [{ event: 'book_opened' }] } })
      expect([202, 403]).toContain(res.statusCode)
      expect(dbMock.activityEvent.createMany).not.toHaveBeenCalled()
    }
  })

  it('refuses free text, long values, bad names, big batches, and signed-out calls', async () => {
    as('coach')
    const app = await getApp()
    const bad = [
      { events: [{ event: 'Board Saved' }] },
      { events: [{ event: 'board_saved', props: { note: 'x'.repeat(81) } }] },
      { events: [{ event: 'board_saved', path: '/editor?id=12&name=Sam' }] },
      { events: Array.from({ length: 26 }, () => ({ event: 'board_saved' })) },
      { events: [{ event: 'board_saved', props: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, 1])) }] },
    ]
    for (const payload of bad) {
      const res = await app.inject({ method: 'POST', url: '/api/activity', headers: await headers(), payload })
      expect(res.statusCode, JSON.stringify(payload).slice(0, 60)).toBe(422)
    }
    const anon = await app.inject({ method: 'POST', url: '/api/activity', payload: { events: [{ event: 'board_saved' }] } })
    expect(anon.statusCode).toBe(401)
  })

  it('kept 13 months: older rows are swept', async () => {
    ;(dbMock.activityEvent.deleteMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 4 })
    const now = new Date('2026-11-23T00:00:00Z')
    expect(await sweepActivity(now)).toBe(4)
    const where = (dbMock.activityEvent.deleteMany.mock.calls[0][0] as { where: { createdAt: { lt: Date } } }).where
    expect(where.createdAt.lt.toISOString()).toBe(new Date(now.getTime() - ACTIVITY_KEEP_DAYS * 86_400_000).toISOString())
    expect(ACTIVITY_KEEP_DAYS).toBeGreaterThanOrEqual(390)
  })

  it('the table goes with the account', () => {
    const sql = readFileSync('prisma/migrations/68_activity_events/migration.sql', 'utf8')
    expect(sql).toContain('REFERENCES `users`(`id`) ON DELETE CASCADE')
  })
})

describe('periods (ANALYTICS-DATES)', () => {
  const now = new Date('2026-11-23T10:00:00Z')
  it('presets end today and are inclusive', () => {
    expect(rangeOf({ range: '7d' }, now)).toMatchObject({ from: '2026-11-17', to: '2026-11-23', days: 7, key: '7d' })
    expect(rangeOf({}, now)).toMatchObject({ days: 30, to: '2026-11-23' })
  })
  it('any from–to; swapped dates are put right; the future is cut to today', () => {
    expect(rangeOf({ from: '2026-11-01', to: '2026-11-10' }, now)).toMatchObject({ from: '2026-11-01', to: '2026-11-10', days: 10, key: '2026-11-01_2026-11-10' })
    expect(rangeOf({ from: '2026-11-10', to: '2026-11-01' }, now)).toMatchObject({ from: '2026-11-01', to: '2026-11-10' })
    expect(rangeOf({ from: '2026-11-20', to: '2026-12-31' }, now)).toMatchObject({ to: '2026-11-23', days: 4 })
  })
  it('every day of the period is listed, quiet days included', () => {
    expect(daysOf(rangeOf({ from: '2026-11-01', to: '2026-11-03' }, now))).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
  })
})

describe('the views', () => {
  it('where coaches stop: steps count only in order', () => {
    const seen = new Map<number, Map<string, number>>([
      [1, new Map([['a', 1], ['b', 2], ['c', 3]])],
      [2, new Map([['a', 1], ['b', 2]])],
      [3, new Map([['a', 5], ['b', 2]])], // b before a: stops at a
      [4, new Map([['b', 1]])], // never did a
    ])
    expect(orderedFunnel(seen, ['a', 'b', 'c'])).toEqual([3, 2, 1])
  })

  it('weeks start on Monday', () => {
    expect(weekOf(new Date('2026-11-23T10:00:00Z'))).toBe('2026-11-23')
    expect(weekOf(new Date('2026-11-29T23:00:00Z'))).toBe('2026-11-23')
  })

  it('owner-only, with any period; usage, stuck, retention, coaches and traffic answer', async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: 1, role: 'owner', accountType: 'coach' } as never)
    ;(dbMock.$queryRaw as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([])
    dbMock.user.count.mockResolvedValue(3 as never)
    dbMock.user.findMany.mockResolvedValue([] as never)
    ;(dbMock.contactMessage.groupBy as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ channel: 'instagram', _count: { _all: 4 } }, { channel: null, _count: { _all: 1 } }])
    const app = await getApp()
    const h = authHeaders(await accessToken(1))
    const usage = await app.inject({ method: 'GET', url: '/api/admin/analytics/usage?from=2026-11-01&to=2026-11-07', headers: h })
    expect(usage.statusCode).toBe(200)
    expect(usage.json()).toMatchObject({ newCoaches: 3, days: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'], activePerDay: [0, 0, 0, 0, 0, 0, 0] })
    for (const url of ['stuck?range=7d', 'retention?range=90d', 'coaches?range=30d']) {
      const res = await app.inject({ method: 'GET', url: `/api/admin/analytics/${url}`, headers: h })
      expect(res.statusCode, url).toBe(200)
    }
    const traffic = await app.inject({ method: 'GET', url: '/api/admin/analytics/traffic?range=30d', headers: h })
    expect(traffic.json()).toMatchObject({ ga4: { status: { state: 'unconfigured' } }, leads: [{ channel: 'instagram', count: 4 }, { channel: 'not asked', count: 1 }] })
    dbMock.user.findUnique.mockResolvedValue({ id: 1, role: 'user', accountType: 'coach' } as never)
    const notOwner = await app.inject({ method: 'GET', url: '/api/admin/analytics/usage', headers: h })
    expect(notOwner.statusCode).toBe(403)
  })

  it('a coach\'s timeline: 404 for an unknown account', async () => {
    dbMock.user.findUnique.mockImplementation(((args: { select?: Record<string, unknown> }) =>
      Promise.resolve(args?.select?.email ? null : { id: 1, role: 'owner', accountType: 'coach' })) as never)
    dbMock.activityEvent.findMany.mockResolvedValue([] as never)
    ;(dbMock.activityEvent.groupBy as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/coaches/99?range=30d', headers: authHeaders(await accessToken(1)) })
    expect(res.statusCode).toBe(404)
  })
})
