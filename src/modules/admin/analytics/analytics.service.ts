// What the Analytics page shows, built from the sources in sources.ts and
// from our own database.
//
// Four views, each its own route so one slow or unconfigured source never
// blocks the others:
//   countries  — users, new users, sign-ups, purchases per country (GA4)
//   features   — product events: totals, weekly trend, top countries per
//                feature (GA4), plus the same counted from OUR tables, which
//                needs no consent and no third party
//   funnels    — pricing → checkout → purchase and visit → sign-up → export
//                (PostHog, strictly ordered; GA4 users-per-step as fallback)
//   health     — open Sentry issues in both projects, errors per day, and
//                failed emails from our own email log
//
// Every external call is wrapped in `sourced()` so the response always says
// which state the source is in: ok / unconfigured / error (with a short
// reason). The page renders the state instead of a blank panel.

import { db } from '../../../config/database.js'
import { env } from '../../../config/env.js'
import { eventLoopLag, requestSummary } from '../../../lib/request-stats.js'
import {
  cached, ga4Configured, ga4Report, posthogConfigured, posthogFunnel, posthogSql,
  rangeDays, sentryConfigured, sentryErrorsPerDay, sentryIssues,
  type FunnelStep, type Range, type SentryIssue, type SourceStatus,
} from './sources.js'

/** The product events the page reports on, grouped as the frontend groups them. */
export const FEATURE_EVENTS: Record<string, string[]> = {
  board: ['board_saved', 'board_exported', 'template_used', 'animation_played', 'ai_generated', 'reel_created'],
  sheets: ['sheet_created', 'sheet_saved', 'sheet_exported'],
  sessions: ['session_created', 'session_exported'],
  players: ['feedback_sent', 'squad_saved'],
  books: ['book_started', 'book_submitted', 'book_opened', 'book_sample_read', 'book_reviewed'],
  growth: ['referral_link_copied', 'club_invite_sent', 'club_joined', 'challenge_entered', 'help_opened', 'tour_completed'],
  billing: ['pricing_viewed', 'begin_checkout', 'purchase', 'subscription_cancelled', 'upgrade_prompt_shown'],
}
const ALL_FEATURE_EVENTS = Object.values(FEATURE_EVENTS).flat()

async function sourced<T>(configured: boolean, fn: () => Promise<T>): Promise<{ status: SourceStatus; data: T | null }> {
  if (!configured) return { status: { state: 'unconfigured' }, data: null }
  try {
    return { status: { state: 'ok' }, data: await fn() }
  } catch (err) {
    return { status: { state: 'error', detail: (err as Error).message?.slice(0, 200) }, data: null }
  }
}

// ---- Countries ----------------------------------------------------------------

export interface CountryRow {
  code: string
  name: string
  users: number
  newUsers: number
  sessions: number
  signups: number
  checkouts: number
  purchases: number
}

export async function countriesView(range: Range) {
  return cached(`countries:${range}`, () =>
    sourced(ga4Configured(), async (): Promise<{ rows: CountryRow[]; totals: Omit<CountryRow, 'code' | 'name'> }> => {
      const [audience, events] = await Promise.all([
        ga4Report({ dimensions: ['countryId', 'country'], metrics: ['activeUsers', 'newUsers', 'sessions'], range, orderByMetricDesc: 'activeUsers' }),
        ga4Report({ dimensions: ['countryId', 'eventName'], metrics: ['eventCount'], range, events: ['account_registered', 'begin_checkout', 'purchase'], limit: 1000 }),
      ])
      const byCode = new Map<string, CountryRow>()
      for (const r of audience) {
        const [code, name] = r.dims
        byCode.set(code, { code, name, users: r.metrics[0], newUsers: r.metrics[1], sessions: r.metrics[2], signups: 0, checkouts: 0, purchases: 0 })
      }
      for (const r of events) {
        const [code, event] = r.dims
        const row = byCode.get(code) ?? { code, name: code, users: 0, newUsers: 0, sessions: 0, signups: 0, checkouts: 0, purchases: 0 }
        if (event === 'account_registered') row.signups += r.metrics[0]
        if (event === 'begin_checkout') row.checkouts += r.metrics[0]
        if (event === 'purchase') row.purchases += r.metrics[0]
        byCode.set(code, row)
      }
      const rows = [...byCode.values()].sort((a, b) => b.users - a.users)
      const totals = rows.reduce(
        (t, r) => ({ users: t.users + r.users, newUsers: t.newUsers + r.newUsers, sessions: t.sessions + r.sessions, signups: t.signups + r.signups, checkouts: t.checkouts + r.checkouts, purchases: t.purchases + r.purchases }),
        { users: 0, newUsers: 0, sessions: 0, signups: 0, checkouts: 0, purchases: 0 },
      )
      return { rows, totals }
    }),
  )
}

// ---- Features -----------------------------------------------------------------

export interface FeatureTotal { event: string; count: number; users: number }
export interface FeatureByCountry { event: string; code: string; name: string; count: number }
export interface WeeklyPoint { week: string; counts: Record<string, number> }

/** ISO week key "2026-W39" for a Date. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Our own tables: what was CREATED, per ISO week, over the range. */
export async function dbFeatureTrend(range: Range): Promise<{ weekly: WeeklyPoint[]; totals: Record<string, number> }> {
  const since = new Date(Date.now() - rangeDays(range) * 86400_000)
  const sel = { select: { createdAt: true }, where: { createdAt: { gte: since } } } as const
  const [users, boards, sheets, sessions, books, notes, subs] = await Promise.all([
    db.user.findMany(sel),
    db.canvasBoard.findMany(sel),
    db.drillSheet.findMany(sel),
    db.trainingSession.findMany(sel),
    db.ebook.findMany(sel),
    db.playerNote.findMany({ select: { createdAt: true }, where: { createdAt: { gte: since }, sentAt: { not: null } } }),
    db.userSubscription.findMany({ select: { createdAt: true }, where: { createdAt: { gte: since }, status: 'active', paymentProvider: 'stripe' } }),
  ])
  const series: Record<string, { createdAt: Date }[]> = {
    signups: users, boards, sheets, sessions, books, feedback: notes, paid: subs,
  }
  const weeks = new Map<string, Record<string, number>>()
  const totals: Record<string, number> = {}
  for (const [key, rows] of Object.entries(series)) {
    totals[key] = rows.length
    for (const r of rows) {
      const w = isoWeek(r.createdAt)
      const bucket = weeks.get(w) ?? {}
      bucket[key] = (bucket[key] ?? 0) + 1
      weeks.set(w, bucket)
    }
  }
  const weekly = [...weeks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([week, counts]) => ({ week, counts }))
  return { weekly, totals }
}

export async function featuresView(range: Range) {
  return cached(`features:${range}`, async () => {
    const [ga, dbTrend] = await Promise.all([
      sourced(ga4Configured(), async () => {
        const [totals, byCountry, daily] = await Promise.all([
          ga4Report({ dimensions: ['eventName'], metrics: ['eventCount', 'totalUsers'], range, events: ALL_FEATURE_EVENTS, orderByMetricDesc: 'eventCount' }),
          ga4Report({ dimensions: ['eventName', 'countryId', 'country'], metrics: ['eventCount'], range, events: ALL_FEATURE_EVENTS, orderByMetricDesc: 'eventCount', limit: 2000 }),
          ga4Report({ dimensions: ['eventName', 'date'], metrics: ['eventCount'], range, events: ALL_FEATURE_EVENTS, limit: 5000 }),
        ])
        const weeks = new Map<string, Record<string, number>>()
        for (const r of daily) {
          const [event, ymd] = r.dims
          const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00Z`)
          const w = isoWeek(d)
          const bucket = weeks.get(w) ?? {}
          bucket[event] = (bucket[event] ?? 0) + r.metrics[0]
          weeks.set(w, bucket)
        }
        return {
          totals: totals.map((r): FeatureTotal => ({ event: r.dims[0], count: r.metrics[0], users: r.metrics[1] })),
          byCountry: byCountry.map((r): FeatureByCountry => ({ event: r.dims[0], code: r.dims[1], name: r.dims[2], count: r.metrics[0] })),
          weekly: [...weeks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([week, counts]): WeeklyPoint => ({ week, counts })),
        }
      }),
      dbFeatureTrend(range),
    ])
    return { groups: FEATURE_EVENTS, ga4: ga, db: dbTrend }
  })
}

// ---- Funnels ------------------------------------------------------------------

export const FUNNELS: Record<string, { label: string; steps: string[] }> = {
  purchase: { label: 'Pricing → checkout → paid', steps: ['pricing_viewed', 'begin_checkout', 'purchase'] },
  activation: { label: 'Sign-up → first board → first export', steps: ['account_registered', 'board_saved', 'board_exported'] },
  books: { label: 'Book opened → sample read → reviewed', steps: ['book_opened', 'book_sample_read', 'book_reviewed'] },
}

export interface FunnelResult { key: string; label: string; steps: FunnelStep[]; ordered: boolean }

export async function funnelsView(range: Range) {
  return cached(`funnels:${range}`, async () => {
    // PostHog: strictly ordered, per person. The real thing.
    const posthog = await sourced(posthogConfigured(), async (): Promise<FunnelResult[]> => {
      const out: FunnelResult[] = []
      for (const [key, f] of Object.entries(FUNNELS)) {
        const steps = await posthogFunnel(f.steps, range, `admin_funnel_${key}`)
        out.push({ key, label: f.label, steps, ordered: true })
      }
      return out
    })
    // GA4: users who did each step at all in the range. Not ordered, but
    // available without PostHog and split by country.
    const ga4 = await sourced(ga4Configured(), async (): Promise<{ funnels: FunnelResult[]; byCountry: { code: string; name: string; steps: Record<string, number> }[] }> => {
      const allSteps = [...new Set(Object.values(FUNNELS).flatMap((f) => f.steps))]
      const [totals, byCountryRows] = await Promise.all([
        ga4Report({ dimensions: ['eventName'], metrics: ['totalUsers'], range, events: allSteps }),
        ga4Report({ dimensions: ['countryId', 'country', 'eventName'], metrics: ['totalUsers'], range, events: FUNNELS.purchase.steps, limit: 1000 }),
      ])
      const users = new Map(totals.map((r) => [r.dims[0], r.metrics[0]]))
      const funnels = Object.entries(FUNNELS).map(([key, f]): FunnelResult => ({
        key, label: f.label, ordered: false, steps: f.steps.map((name) => ({ name, count: users.get(name) ?? 0 })),
      }))
      const byCode = new Map<string, { code: string; name: string; steps: Record<string, number> }>()
      for (const r of byCountryRows) {
        const [code, name, event] = r.dims
        const row = byCode.get(code) ?? { code, name, steps: {} }
        row.steps[event] = r.metrics[0]
        byCode.set(code, row)
      }
      const byCountry = [...byCode.values()].sort((a, b) => (b.steps.pricing_viewed ?? 0) - (a.steps.pricing_viewed ?? 0)).slice(0, 25)
      return { funnels, byCountry }
    })
    return { definitions: FUNNELS, posthog, ga4 }
  })
}

// ---- Health -------------------------------------------------------------------

export async function healthView(range: Range) {
  return cached(`health:${range}`, async () => {
    const period = range === '7d' ? '7d' : range === '30d' ? '30d' : '30d'
    const sentry = await sourced(sentryConfigured(), async (): Promise<{ issues: SentryIssue[]; errorsPerDay: { date: string; count: number }[] }> => {
      const projects = [env.SENTRY_PROJECT_API, env.SENTRY_PROJECT_WEB].filter((p): p is string => Boolean(p))
      const [lists, errorsPerDay] = await Promise.all([
        Promise.all(projects.map((p) => sentryIssues(p, period))),
        sentryErrorsPerDay(Math.min(rangeDays(range), 30)),
      ])
      const issues = lists.flat().sort((a, b) => b.count - a.count).slice(0, 15)
      return { issues, errorsPerDay }
    })
    // Our own signal, always available: emails that failed to send.
    const since = new Date(Date.now() - rangeDays(range) * 86400_000)
    const [emailsSent, emailsFailed, leadsNew] = await Promise.all([
      db.emailLog.count({ where: { createdAt: { gte: since }, status: 'sent' } }),
      db.emailLog.count({ where: { createdAt: { gte: since }, status: 'failed' } }),
      db.contactMessage.count({ where: { status: 'new' } }),
    ])
    return { sentry, db: { emailsSent, emailsFailed, leadsNew } }
  })
}

// ---- PostHog extras (features by country from the person's IP, consent-free) ----

export async function posthogFeaturesByCountry(range: Range) {
  return cached(`ph-features:${range}`, () =>
    sourced(posthogConfigured(), async () => {
      const list = ALL_FEATURE_EVENTS.map((e) => `'${e}'`).join(',')
      const rows = await posthogSql(
        `SELECT event, properties.$geoip_country_code AS country, count() AS n, count(DISTINCT person_id) AS people
         FROM events
         WHERE timestamp >= now() - INTERVAL ${rangeDays(range)} DAY AND event IN (${list})
         GROUP BY event, country ORDER BY n DESC LIMIT 500`,
        'admin_features_by_country',
      )
      return rows.map((r) => ({ event: String(r[0]), code: String(r[1] ?? '??'), count: Number(r[2]) || 0, people: Number(r[3]) || 0 }))
    }),
  )
}

export function sourceStatuses(): Record<'ga4' | 'posthog' | 'sentry', SourceStatus> {
  return {
    ga4: { state: ga4Configured() ? 'ok' : 'unconfigured' },
    posthog: { state: posthogConfigured() ? 'ok' : 'unconfigured' },
    sentry: { state: sentryConfigured() ? 'ok' : 'unconfigured' },
  }
}

// ---- Performance ----------------------------------------------------------------

export interface ApiVitals {
  uptimeSeconds: number
  node: string
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number }
  eventLoopLagMs: { p50: number; p95: number; max: number }
  db: { ok: boolean; pingMs: number; error?: string }
  requests: ReturnType<typeof requestSummary>
}

/** How the API process is doing right now — never cached. */
export async function apiVitals(): Promise<ApiVitals> {
  const mem = process.memoryUsage()
  const mb = (b: number) => Math.round((b / 1048576) * 10) / 10
  const t0 = performance.now()
  let dbState: ApiVitals['db']
  try {
    await db.$queryRaw`SELECT 1`
    dbState = { ok: true, pingMs: Math.round((performance.now() - t0) * 10) / 10 }
  } catch (err) {
    dbState = { ok: false, pingMs: Math.round((performance.now() - t0) * 10) / 10, error: (err as Error).message?.slice(0, 120) }
  }
  return {
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    memory: { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed), heapTotalMb: mb(mem.heapTotal) },
    eventLoopLagMs: eventLoopLag(),
    db: dbState,
    requests: requestSummary(60),
  }
}

/** Google PageSpeed Insights — Lighthouse lab scores + real-user Core Web Vitals (CrUX) for a URL. */
export interface PageSpeed {
  url: string
  strategy: 'mobile' | 'desktop'
  score: number | null
  lab: { lcpMs: number | null; fcpMs: number | null; cls: number | null; tbtMs: number | null; speedIndexMs: number | null; ttfbMs: number | null; totalBytesKb: number | null }
  field: { lcpMs: number | null; inpMs: number | null; cls: number | null; ttfbMs: number | null; category: string | null } | null
  opportunities: { title: string; savingsMs: number }[]
  fetchedAt: string
}

export async function pageSpeed(url: string, strategy: 'mobile' | 'desktop'): Promise<PageSpeed> {
  const q = new URLSearchParams({ url, strategy, category: 'performance' })
  if (env.PAGESPEED_API_KEY) q.set('key', env.PAGESPEED_API_KEY)
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PageSpeed failed (${res.status}) ${text.slice(0, 160)}`)
  }
  const j = (await res.json()) as {
    lighthouseResult?: { categories?: { performance?: { score?: number } }; audits?: Record<string, { numericValue?: number; title?: string; details?: { overallSavingsMs?: number } }> }
    loadingExperience?: { overall_category?: string; metrics?: Record<string, { percentile?: number }> }
  }
  const a = j.lighthouseResult?.audits ?? {}
  const num = (k: string) => (typeof a[k]?.numericValue === 'number' ? Math.round(a[k]!.numericValue! * 100) / 100 : null)
  const ms = (k: string) => { const v = num(k); return v === null ? null : Math.round(v) }
  const f = j.loadingExperience?.metrics
  const fm = (k: string) => (typeof f?.[k]?.percentile === 'number' ? f![k]!.percentile! : null)
  const opportunities = Object.values(a)
    .filter((x) => typeof x.details?.overallSavingsMs === 'number' && x.details!.overallSavingsMs! >= 100 && x.title)
    .map((x) => ({ title: x.title!, savingsMs: Math.round(x.details!.overallSavingsMs!) }))
    .sort((x, y) => y.savingsMs - x.savingsMs)
    .slice(0, 6)
  return {
    url, strategy,
    score: typeof j.lighthouseResult?.categories?.performance?.score === 'number' ? Math.round(j.lighthouseResult.categories.performance.score * 100) : null,
    lab: {
      lcpMs: ms('largest-contentful-paint'), fcpMs: ms('first-contentful-paint'), cls: num('cumulative-layout-shift'),
      tbtMs: ms('total-blocking-time'), speedIndexMs: ms('speed-index'), ttfbMs: ms('server-response-time'),
      totalBytesKb: typeof a['total-byte-weight']?.numericValue === 'number' ? Math.round(a['total-byte-weight']!.numericValue! / 1024) : null,
    },
    field: f ? {
      lcpMs: fm('LARGEST_CONTENTFUL_PAINT_MS'), inpMs: fm('INTERACTION_TO_NEXT_PAINT'),
      cls: fm('CUMULATIVE_LAYOUT_SHIFT_SCORE') === null ? null : fm('CUMULATIVE_LAYOUT_SHIFT_SCORE')! / 100,
      ttfbMs: fm('EXPERIMENTAL_TIME_TO_FIRST_BYTE'), category: j.loadingExperience?.overall_category ?? null,
    } : null,
    opportunities,
    fetchedAt: new Date().toISOString(),
  }
}

/** Both strategies for the public site, cached an hour (a PSI run takes ~30 s). */
export async function pageSpeedView() {
  const url = env.PAGESPEED_URL ?? env.FRONTEND_URL
  return cached(`psi:${url}`, () =>
    sourced(true, async () => {
      const [mobile, desktop] = await Promise.all([pageSpeed(url, 'mobile'), pageSpeed(url, 'desktop')])
      return { mobile, desktop }
    }),
  )
}
