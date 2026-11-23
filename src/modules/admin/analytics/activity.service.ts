// ACTIVITY-LOG views for Admin → Analytics (23 Nov 2026, owner: "what exactly
// users are doing … where are we getting traffic … date wise"). Read from our
// own activity_events table (coach and club accounts only), plus GA4 for the
// website's traffic and our own leads table for "how they heard about us".
//
//   usage      — feature use per day, active coaches per day, the screens they
//                open, and what their videos came out as (quality, encoder)
//   retention  — coaches who signed up in the period, by week, and the share
//                still active in their weeks 1–4
//   stuck      — ordered steps (opened → did → finished): where coaches stop
//   timeline   — one coach's events, newest first
//   traffic    — GA4 channels, sources and landing pages; leads by channel

import { Prisma } from '@prisma/client'
import { db } from '../../../config/database.js'
import { cached, ga4Configured, ga4Report, rangeBounds, type Range, type SourceStatus } from './sources.js'

const day = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10))
const num = (v: unknown) => Number(v ?? 0)

/** Every day of the period, so a quiet day shows as 0 instead of going missing. */
export function daysOf(r: Range): string[] {
  const out: string[] = []
  const start = Date.parse(`${r.from}T00:00:00Z`)
  for (let i = 0; i < r.days; i++) out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10))
  return out
}

// ---- Usage -----------------------------------------------------------------------

export interface UsageView {
  days: string[]
  /** Active coaches per day (anything recorded that day). */
  activePerDay: number[]
  /** Coaches active at all in the period, and new coach/club accounts in it. */
  activeCoaches: number
  newCoaches: number
  /** Per event: total, coaches, and a count per day (aligned with `days`). */
  events: { event: string; total: number; coaches: number; perDay: number[] }[]
  /** Screens opened (page_viewed), most first. */
  screens: { path: string; views: number; coaches: number }[]
  /** Downloaded videos by quality and by the encoder that made them. */
  videos: { quality: { label: string; count: number }[]; encoder: { label: string; count: number }[] }
}

export async function usageView(r: Range): Promise<UsageView> {
  return cached(`act-usage:${r.key}`, async () => {
    const b = rangeBounds(r)
    const [byDayEvent, activeByDay, totals, screens, quality, encoder, active, newCoaches] = await Promise.all([
      db.$queryRaw<{ d: Date; event: string; c: bigint }[]>`
        SELECT DATE(created_at) AS d, event, COUNT(*) AS c FROM activity_events
        WHERE created_at >= ${b.gte} AND created_at < ${b.lt} AND event <> 'page_viewed'
        GROUP BY d, event`,
      db.$queryRaw<{ d: Date; u: bigint }[]>`
        SELECT DATE(created_at) AS d, COUNT(DISTINCT user_id) AS u FROM activity_events
        WHERE created_at >= ${b.gte} AND created_at < ${b.lt} GROUP BY d`,
      db.$queryRaw<{ event: string; c: bigint; u: bigint }[]>`
        SELECT event, COUNT(*) AS c, COUNT(DISTINCT user_id) AS u FROM activity_events
        WHERE created_at >= ${b.gte} AND created_at < ${b.lt} AND event <> 'page_viewed'
        GROUP BY event ORDER BY c DESC LIMIT 80`,
      db.$queryRaw<{ path: string; c: bigint; u: bigint }[]>`
        SELECT path, COUNT(*) AS c, COUNT(DISTINCT user_id) AS u FROM activity_events
        WHERE created_at >= ${b.gte} AND created_at < ${b.lt} AND event = 'page_viewed' AND path IS NOT NULL
        GROUP BY path ORDER BY c DESC LIMIT 25`,
      db.$queryRaw<{ v: string | null; c: bigint }[]>`
        SELECT JSON_UNQUOTE(JSON_EXTRACT(props, '$.quality')) AS v, COUNT(*) AS c FROM activity_events
        WHERE created_at >= ${b.gte} AND created_at < ${b.lt} AND event = 'board_exported'
        GROUP BY v ORDER BY c DESC`,
      db.$queryRaw<{ v: string | null; c: bigint }[]>`
        SELECT JSON_UNQUOTE(JSON_EXTRACT(props, '$.encoder')) AS v, COUNT(*) AS c FROM activity_events
        WHERE created_at >= ${b.gte} AND created_at < ${b.lt} AND event = 'board_exported'
        GROUP BY v ORDER BY c DESC`,
      db.$queryRaw<{ u: bigint }[]>`
        SELECT COUNT(DISTINCT user_id) AS u FROM activity_events WHERE created_at >= ${b.gte} AND created_at < ${b.lt}`,
      db.user.count({ where: { createdAt: b, accountType: { in: ['coach', 'club'] } } }),
    ])
    const days = daysOf(r)
    const idx = new Map(days.map((d, i) => [d, i]))
    const perDay = new Map<string, number[]>()
    for (const row of byDayEvent) {
      const i = idx.get(day(row.d))
      if (i == null) continue
      const arr = perDay.get(row.event) ?? days.map(() => 0)
      arr[i] += num(row.c)
      perDay.set(row.event, arr)
    }
    const activePerDay = days.map(() => 0)
    for (const row of activeByDay) {
      const i = idx.get(day(row.d))
      if (i != null) activePerDay[i] = num(row.u)
    }
    return {
      days,
      activePerDay,
      activeCoaches: num(active[0]?.u),
      newCoaches,
      events: totals.map((t) => ({ event: t.event, total: num(t.c), coaches: num(t.u), perDay: perDay.get(t.event) ?? days.map(() => 0) })),
      screens: screens.map((s) => ({ path: s.path, views: num(s.c), coaches: num(s.u) })),
      videos: {
        quality: quality.map((q) => ({ label: q.v ?? 'unknown', count: num(q.c) })),
        encoder: encoder.map((q) => ({ label: q.v ?? 'unknown', count: num(q.c) })),
      },
    }
  })
}

// ---- Retention ---------------------------------------------------------------------

export interface RetentionView {
  /** One row per signup week (Monday) in the period. */
  cohorts: { week: string; coaches: number; active: (number | null)[] }[]
}

/** Monday of the ISO week a date falls in. */
export function weekOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7))
  return day(t)
}

export async function retentionView(r: Range, now = new Date()): Promise<RetentionView> {
  return cached(`act-retention:${r.key}`, async () => {
    const b = rangeBounds(r)
    const users = await db.user.findMany({ where: { createdAt: b, accountType: { in: ['coach', 'club'] } }, select: { id: true, createdAt: true }, take: 5000 })
    if (!users.length) return { cohorts: [] }
    // Which of their first five weeks (0 = the signup week) each coach was active in.
    const rows = await db.$queryRaw<{ uid: number; wk: number }[]>`
      SELECT a.user_id AS uid, FLOOR(DATEDIFF(a.created_at, u.created_at) / 7) AS wk
      FROM activity_events a JOIN users u ON u.id = a.user_id
      WHERE u.id IN (${Prisma.join(users.map((u) => u.id))}) AND a.created_at >= u.created_at
        AND a.created_at < DATE_ADD(u.created_at, INTERVAL 35 DAY)
      GROUP BY uid, wk`
    const activeIn = new Map<number, Set<number>>()
    for (const row of rows) {
      const set = activeIn.get(num(row.uid)) ?? new Set<number>()
      set.add(num(row.wk))
      activeIn.set(num(row.uid), set)
    }
    const byWeek = new Map<string, { id: number; createdAt: Date }[]>()
    for (const u of users) byWeek.set(weekOf(u.createdAt), [...(byWeek.get(weekOf(u.createdAt)) ?? []), u])
    const cohorts = [...byWeek.entries()].sort(([a], [b2]) => a.localeCompare(b2)).map(([week, list]) => ({
      week,
      coaches: list.length,
      // Weeks 1–4 after signup; null where that week hasn't fully happened for anyone yet.
      active: [1, 2, 3, 4].map((w) => {
        const due = list.filter((u) => u.createdAt.getTime() + (w + 1) * 7 * 86_400_000 <= now.getTime())
        if (!due.length) return null
        return Math.round((due.filter((u) => activeIn.get(u.id)?.has(w)).length / due.length) * 100)
      }),
    }))
    return { cohorts }
  })
}

// ---- Where coaches stop ---------------------------------------------------------------

/**
 * Ordered steps: of the coaches who did step 1 in the period, how many went on
 * to step 2 (after it), then step 3. `opened:<path>` is a screen opened.
 */
export const STUCK_FLOWS: { key: string; label: string; steps: { key: string; label: string }[] }[] = [
  { key: 'first-board', label: 'Board: open → save → video', steps: [
    { key: 'opened:/editor', label: 'Opened the board' }, { key: 'board_saved', label: 'Saved a board' }, { key: 'board_exported', label: 'Downloaded a video' } ] },
  { key: 'week', label: 'Session: plan → run → feedback', steps: [
    { key: 'session_created', label: 'Created a session' }, { key: 'run_finished', label: 'Ran it on the pitch' }, { key: 'feedback_sent', label: 'Sent feedback' } ] },
  { key: 'record', label: 'Record yourself: start → download', steps: [
    { key: 'live_record_started', label: 'Started recording' }, { key: 'live_record_downloaded', label: 'Downloaded it' } ] },
  { key: 'guided', label: 'First visit: guide → own build', steps: [
    { key: 'guided_step_done', label: 'Followed the guide' }, { key: 'guided_build_done', label: 'Finished the guided build' }, { key: 'first_download', label: 'First download' } ] },
  { key: 'upgrade', label: 'Upgrade: prompt → pricing → checkout → paid', steps: [
    { key: 'upgrade_prompt_shown', label: 'Saw an upgrade prompt' }, { key: 'pricing_viewed', label: 'Looked at prices' }, { key: 'begin_checkout', label: 'Started checkout' }, { key: 'purchase', label: 'Paid' } ] },
  { key: 'book', label: 'Book: start → submit', steps: [
    { key: 'book_started', label: 'Started a book' }, { key: 'book_submitted', label: 'Submitted it' } ] },
]

export interface StuckView { flows: { key: string; label: string; steps: { label: string; coaches: number }[] }[] }

export function orderedFunnel(firstAt: Map<number, Map<string, number>>, steps: string[]): number[] {
  const counts = steps.map(() => 0)
  for (const seen of firstAt.values()) {
    let t = -Infinity
    for (let i = 0; i < steps.length; i++) {
      const at = seen.get(steps[i])
      if (at == null || at < t) break
      counts[i]++
      t = at
    }
  }
  return counts
}

export async function stuckView(r: Range): Promise<StuckView> {
  return cached(`act-stuck:${r.key}`, async () => {
    const b = rangeBounds(r)
    const events = [...new Set(STUCK_FLOWS.flatMap((f) => f.steps.map((s) => s.key)).filter((k) => !k.startsWith('opened:')))]
    const paths = [...new Set(STUCK_FLOWS.flatMap((f) => f.steps.map((s) => s.key)).filter((k) => k.startsWith('opened:')).map((k) => k.slice(7)))]
    const rows = await db.$queryRaw<{ uid: number; k: string; t: Date }[]>`
      SELECT user_id AS uid, CASE WHEN event = 'page_viewed' THEN CONCAT('opened:', path) ELSE event END AS k, MIN(created_at) AS t
      FROM activity_events
      WHERE created_at >= ${b.gte} AND created_at < ${b.lt}
        AND (event IN (${Prisma.join(events)}) OR (event = 'page_viewed' AND path IN (${Prisma.join(paths)})))
      GROUP BY uid, k`
    const firstAt = new Map<number, Map<string, number>>()
    for (const row of rows) {
      const m = firstAt.get(num(row.uid)) ?? new Map<string, number>()
      m.set(row.k, new Date(row.t).getTime())
      firstAt.set(num(row.uid), m)
    }
    return {
      flows: STUCK_FLOWS.map((f) => {
        const counts = orderedFunnel(firstAt, f.steps.map((s) => s.key))
        return { key: f.key, label: f.label, steps: f.steps.map((s, i) => ({ label: s.label, coaches: counts[i] })) }
      }),
    }
  })
}

// ---- One coach -----------------------------------------------------------------------

export interface TimelineView {
  user: { id: number; name: string; email: string; accountType: string; createdAt: string } | null
  events: { at: string; event: string; path: string | null; props: Record<string, unknown> | null }[]
  counts: { event: string; count: number }[]
}

export async function timelineView(userId: number, r: Range): Promise<TimelineView> {
  const b = rangeBounds(r)
  const [user, events, counts] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, surname: true, email: true, accountType: true, createdAt: true } }),
    db.activityEvent.findMany({ where: { userId, createdAt: b }, orderBy: { createdAt: 'desc' }, take: 500, select: { createdAt: true, event: true, path: true, props: true } }),
    db.activityEvent.groupBy({ by: ['event'], where: { userId, createdAt: b }, _count: { _all: true }, orderBy: { _count: { event: 'desc' } }, take: 30 }),
  ])
  return {
    user: user ? { id: user.id, name: [user.name, user.surname].filter(Boolean).join(' '), email: user.email, accountType: user.accountType, createdAt: user.createdAt.toISOString() } : null,
    events: events.map((e) => ({ at: e.createdAt.toISOString(), event: e.event, path: e.path, props: (e.props as Record<string, unknown> | null) ?? null })),
    counts: counts.map((c) => ({ event: c.event, count: c._count._all })),
  }
}

/** The most active coaches in the period — the way into a timeline. */
export async function topCoaches(r: Range): Promise<{ id: number; name: string; email: string; events: number; lastAt: string }[]> {
  const b = rangeBounds(r)
  const rows = await db.$queryRaw<{ uid: number; c: bigint; last: Date }[]>`
    SELECT user_id AS uid, COUNT(*) AS c, MAX(created_at) AS last FROM activity_events
    WHERE created_at >= ${b.gte} AND created_at < ${b.lt}
    GROUP BY uid ORDER BY c DESC LIMIT 25`
  if (!rows.length) return []
  const users = await db.user.findMany({ where: { id: { in: rows.map((x) => num(x.uid)) } }, select: { id: true, name: true, surname: true, email: true } })
  const byId = new Map(users.map((u) => [u.id, u]))
  return rows.map((x) => {
    const u = byId.get(num(x.uid))
    return { id: num(x.uid), name: u ? [u.name, u.surname].filter(Boolean).join(' ') : '—', email: u?.email ?? '', events: num(x.c), lastAt: new Date(x.last).toISOString() }
  })
}

// ---- Traffic -----------------------------------------------------------------------

export interface TrafficView {
  ga4: { status: SourceStatus; channels: { name: string; sessions: number; users: number }[]; sources: { name: string; sessions: number; users: number }[]; landing: { name: string; sessions: number }[]; perDay: { date: string; sessions: number }[] } | null
  leads: { channel: string; count: number }[]
}

export async function trafficView(r: Range): Promise<TrafficView> {
  return cached(`traffic:${r.key}`, async () => {
    const b = rangeBounds(r)
    const leads = await db.contactMessage.groupBy({ by: ['channel'], where: { createdAt: b }, _count: { _all: true } })
    let ga4: TrafficView['ga4'] = null
    if (!ga4Configured()) ga4 = { status: { state: 'unconfigured' }, channels: [], sources: [], landing: [], perDay: [] }
    else {
      try {
        const [channels, sources, landing, perDay] = await Promise.all([
          ga4Report({ dimensions: ['sessionDefaultChannelGroup'], metrics: ['sessions', 'totalUsers'], range: r, orderByMetricDesc: 'sessions', limit: 20 }),
          ga4Report({ dimensions: ['sessionSourceMedium'], metrics: ['sessions', 'totalUsers'], range: r, orderByMetricDesc: 'sessions', limit: 25 }),
          ga4Report({ dimensions: ['landingPage'], metrics: ['sessions'], range: r, orderByMetricDesc: 'sessions', limit: 20 }),
          ga4Report({ dimensions: ['date'], metrics: ['sessions'], range: r, limit: 400 }),
        ])
        ga4 = {
          status: { state: 'ok' },
          channels: channels.map((x) => ({ name: x.dims[0] || '(not set)', sessions: x.metrics[0], users: x.metrics[1] })),
          sources: sources.map((x) => ({ name: x.dims[0] || '(not set)', sessions: x.metrics[0], users: x.metrics[1] })),
          landing: landing.map((x) => ({ name: x.dims[0] || '(not set)', sessions: x.metrics[0] })),
          perDay: perDay.map((x) => ({ date: `${x.dims[0].slice(0, 4)}-${x.dims[0].slice(4, 6)}-${x.dims[0].slice(6, 8)}`, sessions: x.metrics[0] })).sort((a, c) => a.date.localeCompare(c.date)),
        }
      } catch (err) {
        ga4 = { status: { state: 'error', detail: (err as Error).message?.slice(0, 200) }, channels: [], sources: [], landing: [], perDay: [] }
      }
    }
    return {
      ga4,
      leads: leads.map((l) => ({ channel: l.channel ?? 'not asked', count: l._count._all })).sort((a, c) => c.count - a.count),
    }
  })
}
