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
  effectiveRpe,
  type WeekStart,
  type WeekTotals,
  type LoadVerdict,
} from '../../lib/planner.js'
import { claimQuota } from '../../lib/plan-quota.js'

/** A coach can plan a whole year, but not ten. */
export const MAX_WEEKS = 60

/** Everything the three screens read off a single session. */
const SESSION_FIELDS = {
  id: true,
  title: true,
  description: true,
  sessionDate: true,
  startTime: true,
  targetMinutes: true,
  intensityRpe: true,
  sessionType: true,
  isMatch: true,
  opponent: true,
  venue: true,
  homeAway: true,
  competition: true,
  goalsFor: true,
  goalsAgainst: true,
  blocks: true,
  parts: true,
} as const

type SessionRow = {
  id: number
  title: string
  description?: string | null
  sessionDate: Date | null
  startTime: string | null
  targetMinutes: number | null
  intensityRpe: number | null
  sessionType: string
  isMatch: boolean
  opponent: string | null
  venue: string | null
  homeAway?: string | null
  competition?: string | null
  goalsFor?: number | null
  goalsAgainst?: number | null
  blocks: unknown
  parts: unknown
}

export interface SessionSummary {
  id: number
  title: string
  /** SEASON-2: one line under the title on the day card. */
  description: string | null
  date: string | null
  startTime: string | null
  minutes: number | null
  rpe: number | null
  /** True when load used the typical RPE for the type (no rating given). */
  rpeEstimated: boolean
  /** Derived — minutes × rpe. Never stored, never sent by the client. */
  load: number
  type: string
  isMatch: boolean
  opponent: string | null
  venue: string | null
  homeAway: string | null
  competition: string | null
  goalsFor: number | null
  goalsAgainst: number | null
  partCount: number
}

function toSummary(row: SessionRow): SessionSummary {
  const parts = Array.isArray(row.parts) ? row.parts : []
  const blocks = Array.isArray(row.blocks) ? row.blocks : []
  const eff = effectiveRpe(row.intensityRpe, row.sessionType, row.isMatch)
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    date: row.sessionDate ? isoDate(row.sessionDate) : null,
    startTime: row.startTime,
    minutes: row.targetMinutes,
    rpe: row.intensityRpe,
    rpeEstimated: eff.estimated && sessionLoad({ minutes: row.targetMinutes, rpe: eff.rpe }) > 0,
    load: sessionLoad({ minutes: row.targetMinutes, rpe: eff.rpe }),
    type: row.sessionType,
    isMatch: row.isMatch,
    opponent: row.opponent,
    venue: row.venue,
    homeAway: row.homeAway ?? null,
    competition: row.competition ?? null,
    goalsFor: row.goalsFor ?? null,
    goalsAgainst: row.goalsAgainst ?? null,
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
  /** SEASON-5: title + description per day, only for this week's days. */
  dayNotes: Record<string, { title: string; description: string }>
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

/** The seven ISO dates of the week that holds `startDate`, in display order. */
export function weekDayIsos(startDate: Date, weekStartsOn: WeekStart): string[] {
  const start = startOfWeek(startDate, weekStartsOn)
  return Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i)))
}

function buildWeek(
  week: { id: number; weekIndex: number; startDate: Date; theme: string | null; phase: string; dayNotes?: unknown },
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
    dayNotes: Object.fromEntries(
      Object.entries((week.dayNotes ?? {}) as Record<string, { title?: string; description?: string }>)
        .filter(([d]) => d >= isoDate(start) && d <= isoDate(addDays(start, 6)))
        .map(([d, n]) => [d, { title: n?.title ?? '', description: n?.description ?? '' }]),
    ),
    phase: week.phase,
    totals: weekTotals(
      // The same RPE the cards show (the coach's, else the typical one), so
      // the week total always equals the sum of its cards.
      ordered.map((s) => ({ minutes: s.minutes, rpe: effectiveRpe(s.rpe, s.type, s.isMatch).rpe, isMatch: s.isMatch })),
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
    include: { sessions: { select: { targetMinutes: true, intensityRpe: true, sessionType: true, isMatch: true } } },
  })
  const previousLoads = previous.map((w) =>
    w.sessions.reduce(
      (sum, s) => sum + sessionLoad({ minutes: s.targetMinutes, rpe: effectiveRpe(s.intensityRpe, s.sessionType, s.isMatch).rpe }),
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
  // Copies are sessions like any other and spend the same quota — this was
  // the one path that created sessions without asking.
  const release = await claimQuota(userId, 'sessions', from.sessions.length)

  const weekStartsOn = from.plan.weekStartsOn as WeekStart
  const fromStart = startOfWeek(from.startDate, weekStartsOn)
  const toStart = startOfWeek(to.startDate, to.plan.weekStartsOn as WeekStart)

  const shifted = shiftSessionsToWeek(
    from.sessions.map((s) => ({ ...s, sessionDate: s.sessionDate })),
    fromStart,
    toStart,
  )

  try {
    await db.trainingSession.createMany({
      data: shifted.map((s) => ({
        userId,
        title: s.title,
        description: s.description ?? null,
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
  } catch (err) {
    await release().catch(() => {})
    throw err
  }
  return shifted.length
}

/**
 * "Rondos · Sun, August 30" → "Rondos".
 *
 * Sessions planned onto a day are named for it (the planner writes the day in
 * the coach's language). In next season's copy that day is wrong, so it goes.
 * The server cannot know which language the day was written in, so the test
 * is structural: a trailing " · …" part, short, containing the original
 * date's day of the month. "Rondos · 4v4" keeps its name.
 */
export function stripDaySuffix(title: string, date: Date | null): string {
  if (!date) return title
  const at = title.lastIndexOf(' · ')
  if (at <= 0) return title
  const tail = title.slice(at + 3)
  const day = String(date.getUTCDate())
  return tail.length <= 40 && new RegExp(`(^|\\D)${day}(\\D|$)`).test(tail) ? title.slice(0, at) : title
}

/**
 * Start a new season from an old one.
 *
 * A coach who planned 2026/27 wants 2027/28 to begin as that plan, not as 42
 * empty weeks. The copy keeps the SHAPE — the same number of weeks, each
 * week's theme and phase, and every training session on the same weekday of
 * the same week number — and moves it all to the new start date.
 *
 * Matches are left behind. A fixture belongs to one date against one
 * opponent; next season's fixtures are not this season's, and copying them
 * would invent forty matches nobody scheduled. (copyWeek drops the opponent
 * for the same reason; here the whole match row goes, because a season of
 * "vs Riverside" training sessions would be worse than none.)
 *
 * Checked against the session quota BEFORE anything is written: a Basic coach
 * copying a 40-session season must be told up front, not left with a plan
 * holding the first twelve.
 *
 * Returns the new plan's id and how many sessions came across, or null when
 * the source is not this coach's.
 */
export async function copyPlan(
  userId: number,
  sourceId: number,
  params: { title: string; startDate: Date; seasonLabel?: string | null },
): Promise<{ planId: number; sessions: number } | null> {
  const source = await db.seasonPlan.findFirst({
    where: { id: sourceId, userId },
    include: {
      weeks: {
        orderBy: { weekIndex: 'asc' },
        include: { sessions: { where: { isMatch: false } } },
      },
    },
  })
  if (!source) return null

  // Every copied session is a session: claimed up front (refused before
  // anything is created), handed back if the copy fails below.
  const sessionCount = source.weeks.reduce((n, w) => n + w.sessions.length, 0)
  const releaseSessions = await claimQuota(userId, 'sessions', sessionCount)

  const weekStartsOn = source.weekStartsOn as WeekStart
  const first = startOfWeek(params.startDate, weekStartsOn)
  const weeks = source.weeks.slice(0, MAX_WEEKS)

  const plan = await db.seasonPlan.create({
    data: {
      userId,
      title: params.title,
      ageGroup: source.ageGroup,
      seasonLabel: params.seasonLabel ?? null,
      startDate: first,
      weekStartsOn,
      weeks: {
        create: weeks.map((w) => ({
          weekIndex: w.weekIndex,
          startDate: addDays(first, (w.weekIndex - 1) * 7),
          theme: w.theme,
          phase: w.phase,
        })),
      },
    },
    select: { id: true, weeks: { select: { id: true, weekIndex: true, startDate: true } } },
  })

  if (sessionCount === 0) return { planId: plan.id, sessions: 0 }

  try {
    const newWeekByIndex = new Map(plan.weeks.map((w) => [w.weekIndex, w]))
    const rows = weeks.flatMap((w) => {
      const target = newWeekByIndex.get(w.weekIndex)
      if (!target) return []
      // Same weekday of the same week number, whatever the gap between seasons.
      return shiftSessionsToWeek(
        w.sessions,
        startOfWeek(w.startDate, weekStartsOn),
        startOfWeek(target.startDate, weekStartsOn),
      ).map((s, i) => ({
        userId,
        title: stripDaySuffix(s.title, w.sessions[i].sessionDate),
        description: s.description ?? null,
        sessionDate: s.sessionDate,
        ageGroup: s.ageGroup,
        squadId: s.squadId,
        targetMinutes: s.targetMinutes,
        blocks: s.blocks as never,
        brand: s.brand as never,
        parts: s.parts as never,
        planWeekId: target.id,
        sessionType: s.sessionType,
        intensityRpe: s.intensityRpe,
        startTime: s.startTime,
        isMatch: false,
        opponent: null,
        venue: null,
      }))
    })
    await db.trainingSession.createMany({ data: rows })
    return { planId: plan.id, sessions: rows.length }
  } catch (err) {
    await releaseSessions().catch(() => {})
    // All or nothing: a half-copied season is worse than a clear error, and
    // the coach would not know which weeks were missing.
    await db.seasonPlan.delete({ where: { id: plan.id } }).catch(() => {})
    throw err
  }
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
