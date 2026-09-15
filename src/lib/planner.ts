// Training load, session structure and week arithmetic.
//
// One file, pure functions, no database — because these numbers appear on three
// different screens and in three different PDFs, and the fastest way to lose a
// coach's trust is for the season view to disagree with the week view about how
// hard his Tuesday was.
//
// The load model is session-RPE, which is the standard every qualified coach is
// taught: load = duration in minutes × perceived intensity on a 1–10 scale. A
// 90-minute session at RPE 6 is 540. We never ask the coach for a load and we
// never store one — storing a derived number is how it drifts out of step with
// the two numbers it came from.

/** The named parts of a session, in the order they happen on the pitch. */
export const SESSION_PARTS = ['warmup', 'main', 'game', 'cooldown'] as const
export type SessionPart = (typeof SESSION_PARTS)[number]

/**
 * A coach may rename parts and have between three and five. Three is the floor
 * because a session without a warm-up, a main part and something to finish on
 * is not a session; five is the ceiling because the printed plan stops fitting
 * on one page and the structure stops being a structure.
 */
export const MIN_PARTS = 3
export const MAX_PARTS = 5

/**
 * What kind of session this is. Drives the colour on all three screens — the
 * coach learns the colours once on the season view and can then read the week
 * and session screens without being taught anything new.
 */
export const SESSION_TYPES = ['physical', 'technical', 'tactical', 'match', 'recovery', 'rest'] as const
export type SessionType = (typeof SESSION_TYPES)[number]

/** Where a week sits in the season. A label, not a navigable level. */
export const SEASON_PHASES = ['pre-season', 'in-season', 'transition'] as const
export type SeasonPhase = (typeof SEASON_PHASES)[number]

export const RPE_MIN = 1
export const RPE_MAX = 10

/** Days in a week, obviously — but named so the arithmetic below reads. */
const DAYS = 7

export interface SessionLoadInput {
  /** Planned length in minutes. */
  minutes: number | null | undefined
  /** Perceived intensity, 1–10. */
  rpe: number | null | undefined
}

/**
 * Session load = minutes × RPE.
 *
 * Returns 0 rather than null when either number is missing, so a half-planned
 * week still adds up. A coach who has not yet set an RPE has not yet planned
 * any load — that is a true statement, not a gap.
 */
export function sessionLoad(session: SessionLoadInput): number {
  const minutes = Number(session.minutes ?? 0)
  const rpe = Number(session.rpe ?? 0)
  if (!Number.isFinite(minutes) || !Number.isFinite(rpe)) return 0
  if (minutes <= 0 || rpe <= 0) return 0
  return Math.round(minutes * clampRpe(rpe))
}

/**
 * Bring an RPE into 1–10, preserving 0 as "not set yet".
 *
 * That exception matters: clamping 0 up to 1 would silently turn a session the
 * coach has not rated into a session he rated as very easy, and that invented
 * number would then flow into his weekly load.
 */
export function clampRpe(rpe: number): number {
  if (!Number.isFinite(rpe) || rpe <= 0) return 0
  return Math.min(RPE_MAX, Math.max(RPE_MIN, Math.round(rpe)))
}

export interface WeekTotals {
  /** Sum of every session's load. */
  load: number
  /** Total minutes on the pitch. */
  volume: number
  /** Minutes-weighted mean RPE, to one decimal. */
  avgIntensity: number
  sessionCount: number
  matchCount: number
}

/**
 * Roll a week's sessions into the four numbers shown at the top of the week
 * screen and in the right-hand column of the season screen.
 *
 * Average intensity is weighted BY MINUTES, not a plain mean of the RPEs. A
 * 20-minute recovery run at RPE 2 next to a 90-minute session at RPE 8 averages
 * to 6.9, not 5 — and 5 would tell the coach his week was moderate when it was
 * not.
 */
export function weekTotals(sessions: (SessionLoadInput & { isMatch?: boolean })[]): WeekTotals {
  let load = 0
  let volume = 0
  let matchCount = 0

  for (const session of sessions) {
    load += sessionLoad(session)
    const minutes = Number(session.minutes ?? 0)
    if (Number.isFinite(minutes) && minutes > 0) volume += Math.round(minutes)
    if (session.isMatch) matchCount++
  }

  return {
    load,
    volume,
    // load / volume is exactly the minutes-weighted mean RPE, because load is
    // the sum of (minutes × rpe) and volume is the sum of minutes.
    avgIntensity: volume > 0 ? Math.round((load / volume) * 10) / 10 : 0,
    sessionCount: sessions.length,
    matchCount,
  }
}

/**
 * Acute:chronic workload ratio — this week's load against the rolling average
 * of the weeks before it.
 *
 * The number coaches watch: broadly, under 0.8 is detraining and over 1.5 is a
 * spike. We compute it and label it; we do not tell anyone they are injured.
 *
 * `previousLoads` is most-recent-first. Weeks with no load at all are excluded
 * rather than averaged in as zero — a pre-season gap would otherwise drag the
 * chronic load down and make the first week back look like a spike.
 */
export function acuteChronicRatio(currentLoad: number, previousLoads: number[], window = 4): number | null {
  const meaningful = previousLoads.slice(0, window).filter((l) => l > 0)
  if (meaningful.length === 0) return null
  const chronic = meaningful.reduce((sum, l) => sum + l, 0) / meaningful.length
  if (chronic <= 0) return null
  return Math.round((currentLoad / chronic) * 100) / 100
}

export type LoadVerdict = 'low' | 'safe' | 'high'

/** Which band a ratio falls in. Thresholds in one place, used by both screens. */
export function loadVerdict(ratio: number | null): LoadVerdict | null {
  if (ratio === null) return null
  if (ratio < 0.8) return 'low'
  if (ratio > 1.5) return 'high'
  return 'safe'
}

// ---- Week arithmetic --------------------------------------------------------
//
// All of this works in UTC and on whole days. A training week is a calendar
// idea, not an instant: "Monday the 14th" is the same day whether the coach
// opens the app in São Paulo or Manchester, and doing this arithmetic in local
// time is how a week silently gains or loses a day across a DST boundary.

/** 0 = Sunday … 6 = Saturday, matching Date.getUTCDay(). */
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

export function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function addDays(date: Date, days: number): Date {
  const d = startOfUTCDay(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

/**
 * The first day of the week containing `date`, for a coach whose week starts on
 * `weekStartsOn`.
 *
 * The `+ DAYS) % DAYS` is load-bearing: JavaScript's % keeps the sign of the
 * dividend, so a Sunday (0) in a Monday-start week gives -1 without it, and the
 * week would begin a day after the date it is supposed to contain.
 */
export function startOfWeek(date: Date, weekStartsOn: WeekStart = 1): Date {
  const d = startOfUTCDay(date)
  const shift = (d.getUTCDay() - weekStartsOn + DAYS) % DAYS
  return addDays(d, -shift)
}

/** The seven dates of the week containing `date`, in display order. */
export function weekDays(date: Date, weekStartsOn: WeekStart = 1): Date[] {
  const first = startOfWeek(date, weekStartsOn)
  return Array.from({ length: DAYS }, (_, i) => addDays(first, i))
}

/** Whole days between two dates, ignoring time of day. */
export function daysBetween(a: Date, b: Date): number {
  const ms = startOfUTCDay(b).getTime() - startOfUTCDay(a).getTime()
  return Math.round(ms / 86_400_000)
}

/**
 * Which week of a plan a date falls in, 1-based, or null if it is outside.
 *
 * Counted from the plan's own start date rather than from the calendar, so
 * "week 3" means the third week the coach planned — which is what the number on
 * his screen has to mean.
 */
export function weekIndexFor(planStart: Date, date: Date, weekStartsOn: WeekStart = 1, weeks: number): number | null {
  const first = startOfWeek(planStart, weekStartsOn)
  const offset = daysBetween(first, date)
  if (offset < 0) return null
  const index = Math.floor(offset / DAYS) + 1
  return index > weeks ? null : index
}

/** The date range a given week of a plan covers. */
export function weekRange(
  planStart: Date,
  weekIndex: number,
  weekStartsOn: WeekStart = 1,
): { start: Date; end: Date } {
  const first = startOfWeek(planStart, weekStartsOn)
  const start = addDays(first, (weekIndex - 1) * DAYS)
  return { start, end: addDays(start, DAYS - 1) }
}

/** ISO yyyy-mm-dd, the form every date crosses the API boundary in. */
export function isoDate(date: Date): string {
  return startOfUTCDay(date).toISOString().slice(0, 10)
}

// ---- Copy week --------------------------------------------------------------

/**
 * The only field this function touches. Deliberately NOT an index signature:
 * `[key: string]: unknown` on the constraint makes every other property of the
 * caller's type read back as `unknown`, so the copied rows lose their types
 * exactly where they are about to be written to the database.
 */
export interface CopyableSession {
  sessionDate: Date | null
}

/**
 * Shift a set of sessions from one week to another, keeping each on the same
 * weekday.
 *
 * This is the single biggest time-saver in the feature: most coaches build one
 * week and vary it. Keeping the weekday is the whole point — a Tuesday session
 * must land on the target week's Tuesday, not simply seven days later, which
 * would silently break if the two weeks were not exactly a week apart.
 */
export function shiftSessionsToWeek<T extends CopyableSession>(
  sessions: T[],
  fromWeekStart: Date,
  toWeekStart: Date,
): T[] {
  // Both arguments are already the first day of their week, so the gap between
  // them is a whole number of weeks and every session moves by the same amount.
  // That is what keeps a Tuesday on a Tuesday.
  const offset = daysBetween(fromWeekStart, toWeekStart)
  return sessions.map((session) => ({
    ...session,
    sessionDate: session.sessionDate ? addDays(session.sessionDate, offset) : null,
  }))
}
