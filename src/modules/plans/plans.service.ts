// Season plans: the two levels above a session.
//
// Everything a screen needs is assembled here rather than in the route, because
// the season view and the week view want the same numbers at different
// granularities, and computing them twice is how they end up disagreeing.

import { db } from '../../config/database.js'
import {
  sessionLoad,
  weekTotals,
  acuteChronicRatio,
  loadVerdict,
  weekRange,
  startOfWeek,
  addDays,
  isoDate,
  shiftSessionsToWeek,
  type WeekStart,
  type WeekTotals,
  type LoadVerdict,
} from '../../lib/planner.js'

/** A coach can plan a whole year, but not ten. */
export const MAX_WEEKS = 60

/** Everything the three screens read off a single session. */
const SESSION_FIELDS = {
  id: true,
  title: true,
  sessionDate: true,
  startTime: true,
  targetMinutes: true,
  intensityRpe: true,
  sessionType: true,
  isMatch: true,
  opponent: true,
  venue: true,
  blocks: true,
  parts: true,
} as const

type SessionRow = {
  id: number
  title: string
  sessionDate: Date | null
  startTime: string | null
  targetMinutes: number | null
  intensityRpe: number | null
  sessionType: string
  isMatch: boolean
  opponent: string | null
  venue: string | null
  blocks: unknown
  parts: unknown
}

export interface SessionSummary {
  id: number
  title: string
  date: string | null
  startTime: string | null
  minutes: number | null
  rpe: number | null
  /** Derived — minutes × rpe. Never stored, never sent by the client. */
  load: number
  type: string
  isMatch: boolean
  opponent: string | null
  venue: string | null
  partCount: number
}

function toSummary(row: SessionRow): SessionSummary {
  const parts = Array.isArray(row.parts) ? row.parts : []
  const blocks = Array.isArray(row.blocks) ? row.blocks : []
  return {
    id: row.id,
    title: row.title,
    date: row.sessionDate ? isoDate(row.sessionDate) : null,
    startTime: row.startTime,
    minutes: row.targetMinutes,
    rpe: row.intensityRpe,
    load: sessionLoad({ minutes: row.targetMinutes, rpe: row.intensityRpe }),
    type: row.sessionType,
    isMatch: row.isMatch,
    opponent: row.opponent,
    venue: row.venue,
    // The week card shows "5 parts". A session with no named parts still has
    // blocks, so fall back to counting those rather than showing 0.
    partCount: parts.length || (blocks.length > 0 ? 1 : 0),
  }
}

/**
 * Sessions within a day are ordered by start time, then by id.
 *
 * Any number of sessions may share a day — a morning gym slot and an afternoon
 * pitch session, or a match followed by recovery. A session with no start time
 * sorts last, because an unscheduled session has not been slotted into the day
 * yet and should not jump ahead of one that has.
 */
function byTimeThenId(a: SessionSummary, b: SessionSummary): number {
  if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime) || a.id - b.id
  if (a.startTime) return -1
  if (b.startTime) return 1
  return a.id - b.id
}

export interface WeekSummary {
  id: number
  weekIndex: number
  startDate: string
  endDate: string
  theme: string | null
  phase: string
  totals: WeekTotals
  /** Load per day, in display order. Drives the little bar chart. */
  dailyLoad: number[]
  sessions: SessionSummary[]
}

export interface SeasonPlanView {
  id: number
  title: string
  ageGroup: string | null
  seasonLabel: string | null
  startDate: string
  weekStartsOn: number
  weeks: WeekSummary[]
}

/** The season screen: every week, each with its sessions and totals. */
export async function getPlan(userId: number, planId: number): Promise<SeasonPlanView | null> {
  const plan = await db.seasonPlan.findFirst({
    where: { id: planId, userId },
    include: {
      weeks: {
        orderBy: { weekIndex: 'asc' },
        include: { sessions: { select: SESSION_FIELDS } },
      },
    },
  })
  if (!plan) return null

  const weekStartsOn = plan.weekStartsOn as WeekStart

  return {
    id: plan.id,
    title: plan.title,
    ageGroup: plan.ageGroup,
    seasonLabel: plan.seasonLabel,
    startDate: isoDate(plan.startDate),
    weekStartsOn: plan.weekStartsOn,
    weeks: plan.weeks.map((week) =>
      buildWeek(week, (week.sessions as SessionRow[]).map(toSummary), weekStartsOn),
    ),
  }
}

function buildWeek(
  week: { id: number; weekIndex: number; startDate: Date; theme: string | null; phase: string },
  sessions: SessionSummary[],
  weekStartsOn: WeekStart,
): WeekSummary {
  const start = startOfWeek(week.startDate, weekStartsOn)
  const ordered = [...sessions].sort(byTimeThenId)

  // One bucket per day, in the coach's own display order — so a Sunday-start
  // coach sees Sunday's bar first.
  const dailyLoad = Array.from({ length: 7 }, (_, i) => {
    const day = isoDate(addDays(start, i))
    return ordered.filter((s) => s.date === day).reduce((sum, s) => sum + s.load, 0)
  })

  return {
    id: week.id,
    weekIndex: week.weekIndex,
    startDate: isoDate(start),
    endDate: isoDate(addDays(start, 6)),
    theme: week.theme,
    phase: week.phase,
    totals: weekTotals(
      ordered.map((s) => ({ minutes: s.minutes, rpe: s.rpe, isMatch: s.isMatch })),
    ),
    dailyLoad,
    sessions: ordered,
  }
}

export interface WeekView extends WeekSummary {
  planId: number
  planTitle: string
  weekStartsOn: number
  /** The seven dates of this week, in display order. */
  days: string[]
  acuteChronic: number | null
  loadVerdict: LoadVerdict | null
  /** For the "+31% vs week 2" line. Null when there is no previous week. */
  previousLoad: number | null
}

/** The week screen. */
export async function getWeek(userId: number, weekId: number): Promise<WeekView | null> {
  const week = await db.planWeek.findFirst({
    where: { id: weekId, plan: { userId } },
    include: {
      plan: { select: { id: true, title: true, weekStartsOn: true } },
      sessions: { select: SESSION_FIELDS },
    },
  })
  if (!week) return null

  const weekStartsOn = week.plan.weekStartsOn as WeekStart
  const base = buildWeek(week, (week.sessions as SessionRow[]).map(toSummary), weekStartsOn)

  // The four weeks before this one, most recent first — the chronic load.
  const previous = await db.planWeek.findMany({
    where: { planId: week.planId, weekIndex: { lt: week.weekIndex } },
    orderBy: { weekIndex: 'desc' },
    take: 4,
    include: { sessions: { select: { targetMinutes: true, intensityRpe: true } } },
  })
  const previousLoads = previous.map((w) =>
    w.sessions.reduce(
      (sum, s) => sum + sessionLoad({ minutes: s.targetMinutes, rpe: s.intensityRpe }),
      0,
    ),
  )

  const ratio = acuteChronicRatio(base.totals.load, previousLoads)
  const start = startOfWeek(week.startDate, weekStartsOn)

  return {
    ...base,
    planId: week.plan.id,
    planTitle: week.plan.title,
    weekStartsOn: week.plan.weekStartsOn,
    days: Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i))),
    acuteChronic: ratio,
    loadVerdict: loadVerdict(ratio),
    previousLoad: previousLoads.length > 0 ? previousLoads[0] : null,
  }
}

/**
 * Create a plan and its weeks in one go.
 *
 * The weeks are materialised up front rather than lazily, because the season
 * screen is a list of weeks — a plan with no week rows would open empty, and
 * "add your first week" is not a thing a coach should have to do after telling
 * us the season is 42 weeks long.
 */
export async function createPlan(params: {
  userId: number
  title: string
  ageGroup?: string | null
  seasonLabel?: string | null
  startDate: Date
  weekStartsOn: WeekStart
  weeks: number
}): Promise<number> {
  const { userId, title, ageGroup, seasonLabel, startDate, weekStartsOn, weeks } = params
  const first = startOfWeek(startDate, weekStartsOn)

  const plan = await db.seasonPlan.create({
    data: {
      userId,
      title,
      ageGroup: ageGroup ?? null,
      seasonLabel: seasonLabel ?? null,
      // Stored already snapped to the week start, so every later calculation
      // agrees about where week 1 begins.
      startDate: first,
      weekStartsOn,
      weeks: {
        create: Array.from({ length: weeks }, (_, i) => ({
          weekIndex: i + 1,
          startDate: addDays(first, i * 7),
        })),
      },
    },
    select: { id: true },
  })
  return plan.id
}

/** Append weeks to the end of a plan. */
export async function addWeeks(planId: number, count: number): Promise<void> {
  const plan = await db.seasonPlan.findUniqueOrThrow({
    where: { id: planId },
    select: { startDate: true, weekStartsOn: true, weeks: { select: { weekIndex: true } } },
  })
  const highest = plan.weeks.reduce((max, w) => Math.max(max, w.weekIndex), 0)
  const remaining = Math.min(count, MAX_WEEKS - highest)
  if (remaining <= 0) return

  const first = startOfWeek(plan.startDate, plan.weekStartsOn as WeekStart)
  await db.planWeek.createMany({
    data: Array.from({ length: remaining }, (_, i) => ({
      planId,
      weekIndex: highest + i + 1,
      startDate: addDays(first, (highest + i) * 7),
    })),
    // The unique key on (plan, weekIndex) is the real guard; this stops a
    // double-click on "Add week" from turning into a 500.
    skipDuplicates: true,
  })
}

/**
 * Copy every session from one week onto another, keeping each on the same
 * weekday.
 *
 * The single biggest time-saver in the feature: most coaches build one week and
 * vary it. Copies are independent sessions — a later edit to the original must
 * not silently change a week the coach has already been through.
 */
export async function copyWeek(userId: number, fromWeekId: number, toWeekId: number): Promise<number> {
  const [from, to] = await Promise.all([
    db.planWeek.findFirst({
      where: { id: fromWeekId, plan: { userId } },
      include: { plan: { select: { weekStartsOn: true } }, sessions: true },
    }),
    db.planWeek.findFirst({
      where: { id: toWeekId, plan: { userId } },
      include: { plan: { select: { weekStartsOn: true } } },
    }),
  ])
  if (!from || !to) return 0
  if (from.sessions.length === 0) return 0

  const weekStartsOn = from.plan.weekStartsOn as WeekStart
  const fromStart = startOfWeek(from.startDate, weekStartsOn)
  const toStart = startOfWeek(to.startDate, to.plan.weekStartsOn as WeekStart)

  const shifted = shiftSessionsToWeek(
    from.sessions.map((s) => ({ ...s, sessionDate: s.sessionDate })),
    fromStart,
    toStart,
  )

  await db.trainingSession.createMany({
    data: shifted.map((s) => ({
      userId,
      title: s.title,
      sessionDate: s.sessionDate,
      ageGroup: s.ageGroup,
      targetMinutes: s.targetMinutes,
      blocks: s.blocks as never,
      brand: s.brand as never,
      parts: s.parts as never,
      planWeekId: toWeekId,
      sessionType: s.sessionType,
      intensityRpe: s.intensityRpe,
      startTime: s.startTime,
      // A copied week carries the training across but NOT the fixture: an
      // opponent and a venue belong to one date, and duplicating them would
      // invent a second match against Riverside that nobody scheduled.
      isMatch: false,
      opponent: null,
      venue: null,
    })),
  })
  return shifted.length
}

/** Clear a week: sessions become standalone, the week row stays. */
export async function clearWeek(userId: number, weekId: number): Promise<number> {
  const week = await db.planWeek.findFirst({
    where: { id: weekId, plan: { userId } },
    select: { id: true },
  })
  if (!week) return 0
  const result = await db.trainingSession.updateMany({
    where: { planWeekId: weekId, userId },
    data: { planWeekId: null },
  })
  return result.count
}

/** The plan list for the planner landing screen. */
export async function listPlans(userId: number) {
  const plans = await db.seasonPlan.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      weeks: {
        select: { id: true, weekIndex: true, startDate: true, _count: { select: { sessions: true } } },
      },
    },
  })

  return plans.map((plan) => ({
    id: plan.id,
    title: plan.title,
    ageGroup: plan.ageGroup,
    seasonLabel: plan.seasonLabel,
    startDate: isoDate(plan.startDate),
    weekStartsOn: plan.weekStartsOn,
    weekCount: plan.weeks.length,
    sessionCount: plan.weeks.reduce((sum, w) => sum + w._count.sessions, 0),
    endDate: isoDate(
      weekRange(plan.startDate, Math.max(1, plan.weeks.length), plan.weekStartsOn as WeekStart).end,
    ),
  }))
}
