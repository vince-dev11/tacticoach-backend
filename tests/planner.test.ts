// Load maths and week arithmetic.
//
// These numbers are shown on three screens and three PDFs, so they are tested
// at the boundaries rather than at a few convenient values. The week arithmetic
// in particular has two classic traps — negative modulo and daylight saving —
// and both have their own test below.

import { describe, it, expect } from 'vitest'
import {
  sessionLoad,
  clampRpe,
  weekTotals,
  acuteChronicRatio,
  loadVerdict,
  startOfWeek,
  weekDays,
  weekRange,
  weekIndexFor,
  daysBetween,
  addDays,
  isoDate,
  shiftSessionsToWeek,
  SESSION_PARTS,
  SESSION_TYPES,
  MIN_PARTS,
  MAX_PARTS,
  type WeekStart,
} from '../src/lib/planner.js'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('sessionLoad', () => {
  it('is minutes × RPE — the worked example from the design doc', () => {
    expect(sessionLoad({ minutes: 90, rpe: 6 })).toBe(540)
    expect(sessionLoad({ minutes: 75, rpe: 5 })).toBe(375)
    expect(sessionLoad({ minutes: 40, rpe: 2 })).toBe(80)
  })

  it('is zero when either number is missing, not null', () => {
    // A half-planned week still has to add up. "No RPE yet" means "no load
    // planned yet", which is true rather than unknown.
    expect(sessionLoad({ minutes: 90, rpe: null })).toBe(0)
    expect(sessionLoad({ minutes: null, rpe: 6 })).toBe(0)
    expect(sessionLoad({ minutes: undefined, rpe: undefined })).toBe(0)
  })

  it('refuses nonsense rather than producing NaN', () => {
    expect(sessionLoad({ minutes: Number.NaN, rpe: 6 })).toBe(0)
    expect(sessionLoad({ minutes: 90, rpe: Number.POSITIVE_INFINITY })).toBe(0)
    expect(sessionLoad({ minutes: -90, rpe: 6 })).toBe(0)
  })

  it('clamps an out-of-range RPE instead of trusting it', () => {
    // A 90-minute session cannot be load 9000 because someone typed 100.
    expect(sessionLoad({ minutes: 90, rpe: 100 })).toBe(900)
    // 0 survives clamping: it means "not rated yet", and turning it into 1
    // would invent a load the coach never planned.
    expect(clampRpe(0)).toBe(0)
    expect(clampRpe(-3)).toBe(0)
    expect(clampRpe(11)).toBe(10)
    expect(clampRpe(5.4)).toBe(5)
  })
})

describe('weekTotals', () => {
  // Week 3 from the mockup, minus the rest day.
  const week3 = [
    { minutes: 90, rpe: 7 },
    { minutes: 90, rpe: 6 },
    { minutes: 75, rpe: 5 },
    { minutes: 45, rpe: 4 },
    { minutes: 80, rpe: 9, isMatch: true },
    { minutes: 40, rpe: 2 },
  ]

  it('adds up week 3 from the mockup', () => {
    // NOTE: the mockups print 1 940 / 430' in the summary panels, which does
    // not match their own per-session cards. The individual cards do obey
    // minutes × RPE (90 × 7 = 630 and so on), so the cards are right and the
    // summary figures were illustrative. We implement the formula.
    const totals = weekTotals(week3)
    expect(totals.load).toBe(630 + 540 + 375 + 180 + 720 + 80)
    expect(totals.load).toBe(2525)
    expect(totals.volume).toBe(90 + 90 + 75 + 45 + 80 + 40)
    expect(totals.sessionCount).toBe(6)
    expect(totals.matchCount).toBe(1)
  })

  it('weights average intensity by minutes, not by session', () => {
    // 20 min at RPE 2 next to 90 min at RPE 8. A plain mean says 5 — which
    // would tell the coach his week was moderate when it was not.
    const totals = weekTotals([
      { minutes: 20, rpe: 2 },
      { minutes: 90, rpe: 8 },
    ])
    expect(totals.avgIntensity).toBe(6.9)
    expect(totals.avgIntensity).not.toBe(5)
  })

  it('handles an empty week without dividing by zero', () => {
    expect(weekTotals([])).toEqual({
      load: 0,
      volume: 0,
      avgIntensity: 0,
      sessionCount: 0,
      matchCount: 0,
    })
  })

  it('counts a planned session with no numbers yet', () => {
    const totals = weekTotals([{ minutes: null, rpe: null }])
    expect(totals.sessionCount).toBe(1)
    expect(totals.load).toBe(0)
    expect(totals.avgIntensity).toBe(0)
  })
})

describe('acuteChronicRatio', () => {
  it('compares this week against the rolling average', () => {
    expect(acuteChronicRatio(1200, [1000, 1000, 1000, 1000])).toBe(1.2)
    expect(acuteChronicRatio(800, [1000, 1000])).toBe(0.8)
  })

  it('ignores weeks with no load rather than averaging them in as zero', () => {
    // A pre-season gap would otherwise drag the chronic load down and make the
    // first week back look like a spike.
    expect(acuteChronicRatio(1000, [1000, 0, 0, 1000])).toBe(1)
  })

  it('returns null when there is nothing to compare against', () => {
    expect(acuteChronicRatio(1000, [])).toBeNull()
    expect(acuteChronicRatio(1000, [0, 0, 0])).toBeNull()
  })

  it('only looks back as far as the window', () => {
    // The fifth week is outside a 4-week window and must not pull the average.
    expect(acuteChronicRatio(1000, [1000, 1000, 1000, 1000, 100])).toBe(1)
  })
})

describe('loadVerdict', () => {
  it('bands the ratio at 0.8 and 1.5', () => {
    expect(loadVerdict(0.79)).toBe('low')
    expect(loadVerdict(0.8)).toBe('safe')
    expect(loadVerdict(1.18)).toBe('safe')
    expect(loadVerdict(1.5)).toBe('safe')
    expect(loadVerdict(1.51)).toBe('high')
    expect(loadVerdict(null)).toBeNull()
  })
})

describe('startOfWeek', () => {
  it('finds Monday for a Monday-start coach', () => {
    // 16 Sep 2026 is a Wednesday.
    expect(isoDate(startOfWeek(d('2026-09-16'), 1))).toBe('2026-09-14')
  })

  it('handles Sunday in a Monday-start week — the negative-modulo trap', () => {
    // JavaScript's % keeps the sign of the dividend, so Sunday (0) minus
    // Monday (1) gives -1. Without the +7 the week would start on the 21st,
    // a day AFTER the date it is supposed to contain.
    const sunday = d('2026-09-20')
    const start = startOfWeek(sunday, 1)
    expect(isoDate(start)).toBe('2026-09-14')
    expect(daysBetween(start, sunday)).toBe(6)
  })

  it('respects a coach whose week starts on Sunday', () => {
    expect(isoDate(startOfWeek(d('2026-09-16'), 0))).toBe('2026-09-13')
  })

  it('works for every possible week start', () => {
    for (let ws = 0; ws < 7; ws++) {
      const start = startOfWeek(d('2026-09-16'), ws as WeekStart)
      expect(start.getUTCDay()).toBe(ws)
      // The week must always contain the date it was asked about.
      expect(daysBetween(start, d('2026-09-16'))).toBeGreaterThanOrEqual(0)
      expect(daysBetween(start, d('2026-09-16'))).toBeLessThan(7)
    }
  })

  it('returns the day itself when it is already the start', () => {
    expect(isoDate(startOfWeek(d('2026-09-14'), 1))).toBe('2026-09-14')
  })
})

describe('week arithmetic across daylight saving', () => {
  it('keeps seven days in a week through the spring change', () => {
    // UK clocks go forward on 29 March 2026. In local time that week is 167
    // hours, and date arithmetic done locally silently loses a day.
    const days = weekDays(d('2026-03-25'), 1)
    expect(days).toHaveLength(7)
    expect(days.map(isoDate)).toEqual([
      '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26',
      '2026-03-27', '2026-03-28', '2026-03-29',
    ])
  })

  it('keeps seven days through the autumn change', () => {
    const days = weekDays(d('2026-10-28'), 1)
    expect(days).toHaveLength(7)
    expect(isoDate(days[0])).toBe('2026-10-26')
    expect(isoDate(days[6])).toBe('2026-11-01')
  })

  it('crosses a month boundary without repeating or skipping a day', () => {
    const days = weekDays(d('2026-09-30'), 1)
    expect(days.map(isoDate)).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ])
  })

  it('crosses a year boundary', () => {
    const days = weekDays(d('2026-12-31'), 1)
    expect(isoDate(days[0])).toBe('2026-12-28')
    expect(isoDate(days[6])).toBe('2027-01-03')
  })

  it('handles a leap day', () => {
    expect(daysBetween(d('2028-02-28'), d('2028-03-01'))).toBe(2)
  })
})

describe('weekIndexFor and weekRange', () => {
  const planStart = d('2026-08-31') // a Monday

  it('numbers weeks from the plan start, 1-based', () => {
    expect(weekIndexFor(planStart, d('2026-08-31'), 1, 42)).toBe(1)
    expect(weekIndexFor(planStart, d('2026-09-06'), 1, 42)).toBe(1)
    expect(weekIndexFor(planStart, d('2026-09-07'), 1, 42)).toBe(2)
    expect(weekIndexFor(planStart, d('2026-09-16'), 1, 42)).toBe(3)
  })

  it('returns null outside the plan', () => {
    expect(weekIndexFor(planStart, d('2026-08-30'), 1, 42)).toBeNull()
    expect(weekIndexFor(planStart, d('2030-01-01'), 1, 42)).toBeNull()
  })

  it('agrees with weekRange — the round trip must close', () => {
    for (let week = 1; week <= 42; week++) {
      const { start, end } = weekRange(planStart, week, 1)
      expect(daysBetween(start, end)).toBe(6)
      expect(weekIndexFor(planStart, start, 1, 42)).toBe(week)
      expect(weekIndexFor(planStart, end, 1, 42)).toBe(week)
    }
  })

  it('gives week 3 the dates shown in the mockup', () => {
    const { start, end } = weekRange(planStart, 3, 1)
    expect(isoDate(start)).toBe('2026-09-14')
    expect(isoDate(end)).toBe('2026-09-20')
  })
})

describe('shiftSessionsToWeek', () => {
  it('keeps every session on the same weekday', () => {
    const sessions = [
      { sessionDate: d('2026-09-15'), title: 'Tuesday' }, // Tue
      { sessionDate: d('2026-09-19'), title: 'Saturday' }, // Sat
    ]
    const copied = shiftSessionsToWeek(sessions, d('2026-09-14'), d('2026-09-21'))

    expect(isoDate(copied[0].sessionDate!)).toBe('2026-09-22')
    expect(isoDate(copied[1].sessionDate!)).toBe('2026-09-26')
    for (let i = 0; i < sessions.length; i++) {
      expect(copied[i].sessionDate!.getUTCDay()).toBe(sessions[i].sessionDate.getUTCDay())
    }
  })

  it('copies backwards too', () => {
    const copied = shiftSessionsToWeek(
      [{ sessionDate: d('2026-09-16') }],
      d('2026-09-14'),
      d('2026-09-07'),
    )
    expect(isoDate(copied[0].sessionDate!)).toBe('2026-09-09')
  })

  it('keeps weekdays across a month boundary and a DST change', () => {
    const copied = shiftSessionsToWeek(
      [{ sessionDate: d('2026-10-27') }], // a Tuesday
      d('2026-10-26'),
      d('2026-11-02'),
    )
    expect(isoDate(copied[0].sessionDate!)).toBe('2026-11-03')
    expect(copied[0].sessionDate!.getUTCDay()).toBe(2)
  })

  it('leaves an undated session undated', () => {
    const copied = shiftSessionsToWeek([{ sessionDate: null }], d('2026-09-14'), d('2026-09-21'))
    expect(copied[0].sessionDate).toBeNull()
  })

  it('does not mutate the sessions it was given', () => {
    const original = d('2026-09-15')
    const sessions = [{ sessionDate: original }]
    shiftSessionsToWeek(sessions, d('2026-09-14'), d('2026-09-21'))
    expect(isoDate(sessions[0].sessionDate)).toBe('2026-09-15')
  })
})

describe('the shared vocabulary', () => {
  it('names the four parts in the order they happen on the pitch', () => {
    expect(SESSION_PARTS).toEqual(['warmup', 'main', 'game', 'cooldown'])
  })

  it('allows three to five parts', () => {
    expect(MIN_PARTS).toBe(3)
    expect(MAX_PARTS).toBe(5)
    expect(SESSION_PARTS.length).toBeGreaterThanOrEqual(MIN_PARTS)
    expect(SESSION_PARTS.length).toBeLessThanOrEqual(MAX_PARTS)
  })

  it('has a type for every colour in the season legend', () => {
    expect(SESSION_TYPES).toEqual(['physical', 'technical', 'tactical', 'match', 'recovery', 'rest'])
  })
})

describe('addDays', () => {
  it('normalises to the start of the day', () => {
    const noon = new Date('2026-09-16T12:34:56.000Z')
    expect(addDays(noon, 0).toISOString()).toBe('2026-09-16T00:00:00.000Z')
  })
})
