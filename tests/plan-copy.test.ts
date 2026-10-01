// Copying a whole season: the new plan keeps the old one's shape, moved to a
// new start date, and never half-exists.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'

const quota = vi.hoisted(() => ({ state: { limit: null as number | null, used: 0, remaining: null as number | null, allowed: true } }))
vi.mock('../src/lib/plan-quota.js', () => ({
  // copyPlan claims every copied session up front (FT-3). Same rule as before:
  // refuse when they do not fit; otherwise hand back a release.
  claimQuota: vi.fn(async (_u: number, _q: string, count: number) => {
    const { limit, remaining } = quota.state
    if (limit !== null && (remaining ?? 0) < count) {
      throw Object.assign(new Error(`Your plan covers ${limit} saved sessions.`), { statusCode: 402 })
    }
    return async () => {}
  }),
}))

import { copyPlan, stripDaySuffix } from '../src/modules/plans/plans.service.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const iso = (date: Date) => date.toISOString().slice(0, 10)

function session(over: Record<string, unknown> = {}) {
  return {
    id: 1, title: 'Pressing triggers', sessionDate: d('2026-09-15'), startTime: '18:00',
    ageGroup: 'U14', squadId: 7, targetMinutes: 90, intensityRpe: 6, sessionType: 'tactical',
    isMatch: false, opponent: null, venue: null, blocks: [{ kind: 'text', title: 'Rondo', minutes: 10 }],
    brand: {}, parts: ['Warm-up', 'Main part'], ...over,
  }
}

/** Last season: starts Mon 7 Sep 2026, two weeks. */
function lastSeason(sessionsByWeek: Record<string, unknown>[][]) {
  mock.seasonPlan.findFirst.mockResolvedValue({
    id: 5, userId: 1, title: '2026/27', ageGroup: 'U14', weekStartsOn: 1, startDate: d('2026-09-07'),
    weeks: sessionsByWeek.map((sessions, i) => ({
      id: 50 + i, weekIndex: i + 1, startDate: d(i === 0 ? '2026-09-07' : '2026-09-14'),
      theme: i === 0 ? 'Pre-season fitness' : 'Pressing', phase: i === 0 ? 'pre_season' : 'in_season', sessions,
    })),
  } as never)
}

/** What db.seasonPlan.create hands back: the new weeks with ids. */
function created(weeks: number, start = '2027-09-06') {
  mock.seasonPlan.create.mockImplementation((async () => ({
    id: 9,
    weeks: Array.from({ length: weeks }, (_, i) => ({
      id: 90 + i, weekIndex: i + 1, startDate: new Date(d(start).getTime() + i * 7 * 86400000),
    })),
  })) as never)
}

beforeEach(() => {
  quota.state = { limit: null, used: 0, remaining: null, allowed: true }
  mock.trainingSession.createMany.mockResolvedValue({ count: 0 } as never)
  mock.seasonPlan.delete.mockResolvedValue({} as never)
})

describe('copyPlan', () => {
  it('keeps every week, with its theme and phase, from the new start date', async () => {
    lastSeason([[], []])
    created(2)
    await copyPlan(1, 5, { title: '2027/28', startDate: d('2027-09-08') }) // a Wednesday
    const data = (mock.seasonPlan.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    // Snapped to the Monday, like a new plan is.
    expect(iso(data.startDate as Date)).toBe('2027-09-06')
    expect(data).toMatchObject({ title: '2027/28', ageGroup: 'U14', weekStartsOn: 1 })
    const weeks = (data.weeks as { create: Record<string, unknown>[] }).create
    expect(weeks.map((w) => [w.weekIndex, iso(w.startDate as Date), w.theme, w.phase])).toEqual([
      [1, '2027-09-06', 'Pre-season fitness', 'pre_season'],
      [2, '2027-09-13', 'Pressing', 'in_season'],
    ])
  })

  it('puts each session on the same weekday of the same week number', async () => {
    lastSeason([
      [session({ sessionDate: d('2026-09-08') })], // week 1, Tuesday
      [session({ id: 2, sessionDate: d('2026-09-17') })], // week 2, Thursday
    ])
    created(2)
    const result = await copyPlan(1, 5, { title: '2027/28', startDate: d('2027-09-06') })
    expect(result).toEqual({ planId: 9, sessions: 2 })
    const rows = (mock.trainingSession.createMany.mock.calls[0][0] as { data: Record<string, unknown>[] }).data
    expect(rows.map((r) => [iso(r.sessionDate as Date), r.planWeekId])).toEqual([
      ['2027-09-07', 90], // Tuesday of week 1
      ['2027-09-16', 91], // Thursday of week 2
    ])
    // The training itself comes across whole.
    expect(rows[0]).toMatchObject({ title: 'Pressing triggers', targetMinutes: 90, intensityRpe: 6, squadId: 7, startTime: '18:00' })
    expect(rows[0].blocks).toEqual([{ kind: 'text', title: 'Rondo', minutes: 10 }])
  })

  it('leaves matches behind — next season has different fixtures', async () => {
    lastSeason([[session()], []])
    created(2)
    await copyPlan(1, 5, { title: 'x', startDate: d('2027-09-06') })
    // Matches are filtered out in the query itself.
    const query = mock.seasonPlan.findFirst.mock.calls[0][0] as { include: { weeks: { include: { sessions: { where: unknown } } } } }
    expect(query.include.weeks.include.sessions.where).toEqual({ isMatch: false })
  })

  it('only copies a plan this coach owns', async () => {
    mock.seasonPlan.findFirst.mockResolvedValue(null as never)
    expect(await copyPlan(1, 999, { title: 'x', startDate: d('2027-09-06') })).toBeNull()
    expect((mock.seasonPlan.findFirst.mock.calls[0][0] as { where: unknown }).where).toEqual({ id: 999, userId: 1 })
    expect(mock.seasonPlan.create).not.toHaveBeenCalled()
  })

  it('refuses up front when the sessions would not fit the coach\'s plan — nothing is created', async () => {
    quota.state = { limit: 12, used: 10, remaining: 2, allowed: true }
    lastSeason([[session(), session({ id: 2 })], [session({ id: 3 })]])
    created(2)
    await expect(copyPlan(1, 5, { title: 'x', startDate: d('2027-09-06') })).rejects.toMatchObject({ statusCode: 402 })
    expect(mock.seasonPlan.create).not.toHaveBeenCalled()
  })

  it('removes the new plan if the sessions fail to copy, so there is no half season', async () => {
    lastSeason([[session()], []])
    created(2)
    mock.trainingSession.createMany.mockRejectedValue(new Error('db down') as never)
    await expect(copyPlan(1, 5, { title: 'x', startDate: d('2027-09-06') })).rejects.toThrow('db down')
    expect(mock.seasonPlan.delete).toHaveBeenCalledWith({ where: { id: 9 } })
  })
})

describe('stripDaySuffix', () => {
  it('drops last season\'s day from a planned session\'s name, in any language', () => {
    expect(stripDaySuffix('Rondos · Sun, August 30', d('2026-08-30'))).toBe('Rondos')
    expect(stripDaySuffix('Rondos · dom, 30 de agosto', d('2026-08-30'))).toBe('Rondos')
    expect(stripDaySuffix('Rondos · 8月30日(日)', d('2026-08-30'))).toBe('Rondos')
  })
  it('keeps a coach\'s own " · " part', () => {
    expect(stripDaySuffix('Rondos · 4v4', d('2026-08-30'))).toBe('Rondos · 4v4')
    expect(stripDaySuffix('Rondos · Sun, August 3', d('2026-08-30'))).toBe('Rondos · Sun, August 3')
    expect(stripDaySuffix('Rondos', d('2026-08-30'))).toBe('Rondos')
    expect(stripDaySuffix('Rondos · Sun, August 30', null)).toBe('Rondos · Sun, August 30')
  })
})
