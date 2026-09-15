// Season planner service: what the three screens are handed, and the cases
// where a careless implementation leaks or loses a coach's work.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { createPlan, copyWeek, clearWeek, getWeek, getPlan } from '../src/modules/plans/plans.service.js'

// Typed once prisma generate has run against the new schema; the deep mock
// creates these at runtime regardless.
const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const iso = (date: Date) => date.toISOString().slice(0, 10)

function sessionRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'Positioning 4-4-2',
    sessionDate: d('2026-09-16'),
    startTime: '18:00',
    targetMinutes: 90,
    intensityRpe: 6,
    sessionType: 'tactical',
    isMatch: false,
    opponent: null,
    venue: null,
    blocks: [],
    parts: ['Warm-up', 'Main part', 'Game', 'Cool-down'],
    ...over,
  }
}

beforeEach(() => {
  mock.trainingSession.createMany.mockResolvedValue({ count: 0 } as never)
  mock.trainingSession.updateMany.mockResolvedValue({ count: 0 } as never)
  mock.planWeek.findMany.mockResolvedValue([] as never)
  mock.planWeek.createMany.mockResolvedValue({ count: 0 } as never)
})

describe('createPlan', () => {
  it('materialises every week up front, snapped to the week start', async () => {
    mock.seasonPlan.create.mockResolvedValue({ id: 7 } as never)

    // 2 September 2026 is a Wednesday; a Monday-start plan begins on the 31st.
    await createPlan({
      userId: 1,
      title: 'U15 Boys',
      startDate: d('2026-09-02'),
      weekStartsOn: 1,
      weeks: 42,
    })

    const arg = mock.seasonPlan.create.mock.calls[0][0] as {
      data: { startDate: Date; weeks: { create: { weekIndex: number; startDate: Date }[] } }
    }
    expect(iso(arg.data.startDate)).toBe('2026-08-31')

    const weeks = arg.data.weeks.create
    expect(weeks).toHaveLength(42)
    expect(weeks[0]).toMatchObject({ weekIndex: 1 })
    expect(iso(weeks[0].startDate)).toBe('2026-08-31')
    // Week 3 is the one in the mockup.
    expect(iso(weeks[2].startDate)).toBe('2026-09-14')
    // Every week starts on a Monday, including across both DST changes.
    for (const week of weeks) expect(week.startDate.getUTCDay()).toBe(1)
  })

  it('numbers weeks consecutively from 1 with no gaps', async () => {
    mock.seasonPlan.create.mockResolvedValue({ id: 7 } as never)
    await createPlan({ userId: 1, title: 'x', startDate: d('2026-08-31'), weekStartsOn: 1, weeks: 10 })

    const weeks = (mock.seasonPlan.create.mock.calls[0][0] as { data: { weeks: { create: { weekIndex: number }[] } } })
      .data.weeks.create
    expect(weeks.map((w) => w.weekIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('honours a Sunday-start coach', async () => {
    mock.seasonPlan.create.mockResolvedValue({ id: 7 } as never)
    await createPlan({ userId: 1, title: 'x', startDate: d('2026-09-02'), weekStartsOn: 0, weeks: 3 })

    const arg = mock.seasonPlan.create.mock.calls[0][0] as { data: { startDate: Date } }
    expect(iso(arg.data.startDate)).toBe('2026-08-30')
    expect(arg.data.startDate.getUTCDay()).toBe(0)
  })
})

describe('getPlan', () => {
  it('derives load per session and rolls it into week totals', async () => {
    mock.seasonPlan.findFirst.mockResolvedValue({
      id: 7,
      title: 'U15 Boys',
      ageGroup: 'U15',
      seasonLabel: '2026/27',
      startDate: d('2026-08-31'),
      weekStartsOn: 1,
      weeks: [
        {
          id: 3,
          weekIndex: 3,
          startDate: d('2026-09-14'),
          theme: 'Build-up play',
          phase: 'in-season',
          sessions: [
            sessionRow({ id: 1, sessionDate: d('2026-09-15'), targetMinutes: 90, intensityRpe: 7 }),
            sessionRow({ id: 2, sessionDate: d('2026-09-16'), targetMinutes: 90, intensityRpe: 6 }),
          ],
        },
      ],
    } as never)

    const plan = await getPlan(1, 7)

    expect(plan!.weeks[0].sessions.map((s) => s.load)).toEqual([630, 540])
    expect(plan!.weeks[0].totals.load).toBe(1170)
    expect(plan!.weeks[0].totals.volume).toBe(180)
    // Tuesday and Wednesday of a Monday-start week.
    expect(plan!.weeks[0].dailyLoad).toEqual([0, 630, 540, 0, 0, 0, 0])
  })

  it('puts the daily bars in the coach’s own day order', async () => {
    // Sunday-start: the same Tuesday session lands in a different bucket.
    mock.seasonPlan.findFirst.mockResolvedValue({
      id: 7,
      title: 'x',
      ageGroup: null,
      seasonLabel: null,
      startDate: d('2026-09-13'),
      weekStartsOn: 0,
      weeks: [
        {
          id: 3,
          weekIndex: 1,
          startDate: d('2026-09-13'),
          theme: null,
          phase: 'in-season',
          sessions: [sessionRow({ sessionDate: d('2026-09-15'), targetMinutes: 90, intensityRpe: 7 })],
        },
      ],
    } as never)

    const plan = await getPlan(1, 7)
    // Sun Mon Tue … — Tuesday is index 2.
    expect(plan!.weeks[0].dailyLoad).toEqual([0, 0, 630, 0, 0, 0, 0])
  })

  it('returns null for a plan this coach does not own', async () => {
    mock.seasonPlan.findFirst.mockResolvedValue(null as never)
    expect(await getPlan(99, 7)).toBeNull()
  })

  it('orders same-day sessions by start time, unscheduled last', async () => {
    mock.seasonPlan.findFirst.mockResolvedValue({
      id: 7, title: 'x', ageGroup: null, seasonLabel: null,
      startDate: d('2026-09-14'), weekStartsOn: 1,
      weeks: [{
        id: 3, weekIndex: 1, startDate: d('2026-09-14'), theme: null, phase: 'in-season',
        sessions: [
          sessionRow({ id: 3, startTime: null }),
          sessionRow({ id: 1, startTime: '18:00' }),
          sessionRow({ id: 2, startTime: '09:30' }),
        ],
      }],
    } as never)

    const plan = await getPlan(1, 7)
    // A morning gym slot then an afternoon session — the double-session case.
    // The unscheduled one goes last: it has not been slotted into the day yet.
    expect(plan!.weeks[0].sessions.map((s) => s.id)).toEqual([2, 1, 3])
  })
})

describe('getWeek', () => {
  function weekWith(load: { minutes: number; rpe: number }[], previous: number[][] = []) {
    mock.planWeek.findFirst.mockResolvedValue({
      id: 3,
      planId: 7,
      weekIndex: 3,
      startDate: d('2026-09-14'),
      theme: null,
      phase: 'in-season',
      plan: { id: 7, title: 'U15 Boys', weekStartsOn: 1 },
      sessions: load.map((l, i) =>
        sessionRow({ id: i + 1, targetMinutes: l.minutes, intensityRpe: l.rpe }),
      ),
    } as never)
    mock.planWeek.findMany.mockResolvedValue(
      previous.map((sessions, i) => ({
        weekIndex: 2 - i,
        sessions: sessions.map((load) => ({ targetMinutes: load, intensityRpe: 1 })),
      })) as never,
    )
  }

  it('computes the acute:chronic ratio against earlier weeks', async () => {
    weekWith([{ minutes: 100, rpe: 10 }], [[1000], [1000], [1000]])

    const week = await getWeek(1, 3)
    expect(week!.totals.load).toBe(1000)
    expect(week!.acuteChronic).toBe(1)
    expect(week!.loadVerdict).toBe('safe')
    expect(week!.previousLoad).toBe(1000)
  })

  it('flags a spike', async () => {
    weekWith([{ minutes: 200, rpe: 10 }], [[1000], [1000]])
    const week = await getWeek(1, 3)
    expect(week!.acuteChronic).toBe(2)
    expect(week!.loadVerdict).toBe('high')
  })

  it('has no ratio in week 1 — nothing to compare against', async () => {
    weekWith([{ minutes: 90, rpe: 6 }], [])
    const week = await getWeek(1, 3)
    expect(week!.acuteChronic).toBeNull()
    expect(week!.loadVerdict).toBeNull()
    expect(week!.previousLoad).toBeNull()
  })

  it('lists the seven days of the week in display order', async () => {
    weekWith([{ minutes: 90, rpe: 6 }])
    const week = await getWeek(1, 3)
    expect(week!.days).toEqual([
      '2026-09-14', '2026-09-15', '2026-09-16',
      '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20',
    ])
  })

  it('returns null for another coach’s week', async () => {
    mock.planWeek.findFirst.mockResolvedValue(null as never)
    expect(await getWeek(99, 3)).toBeNull()
  })
})

describe('copyWeek', () => {
  function weeks(sessions: Record<string, unknown>[]) {
    mock.planWeek.findFirst
      .mockResolvedValueOnce({
        id: 3,
        startDate: d('2026-09-14'),
        plan: { weekStartsOn: 1 },
        sessions,
      } as never)
      .mockResolvedValueOnce({
        id: 4,
        startDate: d('2026-09-21'),
        plan: { weekStartsOn: 1 },
      } as never)
  }

  it('keeps each session on the same weekday in the target week', async () => {
    weeks([
      sessionRow({ id: 1, sessionDate: d('2026-09-15') }), // Tuesday
      sessionRow({ id: 2, sessionDate: d('2026-09-19') }), // Saturday
    ])

    expect(await copyWeek(1, 3, 4)).toBe(2)

    const created = (mock.trainingSession.createMany.mock.calls[0][0] as {
      data: { sessionDate: Date }[]
    }).data
    expect(iso(created[0].sessionDate)).toBe('2026-09-22') // Tuesday
    expect(iso(created[1].sessionDate)).toBe('2026-09-26') // Saturday
  })

  it('files the copies into the target week, not the source', async () => {
    weeks([sessionRow({ sessionDate: d('2026-09-15') })])
    await copyWeek(1, 3, 4)

    const created = (mock.trainingSession.createMany.mock.calls[0][0] as {
      data: { planWeekId: number }[]
    }).data
    expect(created[0].planWeekId).toBe(4)
  })

  it('does NOT copy the fixture across', async () => {
    // An opponent and a venue belong to one date. Copying them would invent a
    // second match against Riverside that nobody scheduled.
    weeks([
      sessionRow({
        sessionDate: d('2026-09-19'),
        isMatch: true,
        opponent: 'Riverside FC',
        venue: 'Home',
        sessionType: 'match',
      }),
    ])
    await copyWeek(1, 3, 4)

    const created = (mock.trainingSession.createMany.mock.calls[0][0] as {
      data: { isMatch: boolean; opponent: string | null; venue: string | null }[]
    }).data
    expect(created[0]).toMatchObject({ isMatch: false, opponent: null, venue: null })
  })

  it('carries the training detail across', async () => {
    weeks([sessionRow({ sessionDate: d('2026-09-15'), targetMinutes: 90, intensityRpe: 7 })])
    await copyWeek(1, 3, 4)

    const created = (mock.trainingSession.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[]
    }).data
    expect(created[0]).toMatchObject({
      title: 'Positioning 4-4-2',
      targetMinutes: 90,
      intensityRpe: 7,
      sessionType: 'tactical',
      startTime: '18:00',
    })
  })

  it('copies nothing from an empty week', async () => {
    weeks([])
    expect(await copyWeek(1, 3, 4)).toBe(0)
    expect(mock.trainingSession.createMany).not.toHaveBeenCalled()
  })

  it('refuses when either week belongs to someone else', async () => {
    mock.planWeek.findFirst.mockResolvedValue(null as never)
    expect(await copyWeek(99, 3, 4)).toBe(0)
    expect(mock.trainingSession.createMany).not.toHaveBeenCalled()
  })
})

describe('clearWeek', () => {
  it('detaches sessions rather than deleting them', async () => {
    // The coach's actual work must survive emptying a week — it returns to his
    // session library as a standalone session.
    mock.planWeek.findFirst.mockResolvedValue({ id: 3 } as never)
    mock.trainingSession.updateMany.mockResolvedValue({ count: 4 } as never)

    expect(await clearWeek(1, 3)).toBe(4)
    expect(mock.trainingSession.updateMany).toHaveBeenCalledWith({
      where: { planWeekId: 3, userId: 1 },
      data: { planWeekId: null },
    })
    expect(mock.trainingSession.deleteMany).not.toHaveBeenCalled()
  })

  it('does nothing for another coach’s week', async () => {
    mock.planWeek.findFirst.mockResolvedValue(null as never)
    expect(await clearWeek(99, 3)).toBe(0)
    expect(mock.trainingSession.updateMany).not.toHaveBeenCalled()
  })
})
