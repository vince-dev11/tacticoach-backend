// The three external analytics sources the admin Analytics page reads from,
// plus a small in-memory cache, all behind one shape:
//
//   ga4      Google Analytics 4 Data API — countries, feature events, funnel
//            steps. Auth: a Google service account (JSON key) that has been
//            given Viewer on the GA4 property. The JWT → access-token exchange
//            is done here with node:crypto, so there is no Google SDK to carry.
//   posthog  PostHog query API — ordered funnels (FunnelsQuery) and feature
//            usage with $geoip country, by HogQL. Auth: personal API key with
//            Query Read.
//   sentry   Sentry web API — open issues and daily error counts for both
//            projects. Auth: an organisation auth token with project:read
//            and org:read.
//
// Every source is OPTIONAL. Without its env it reports `unconfigured` and the
// page shows how to connect it instead of an error. Keys live in the server
// env only; nothing here is ever exposed to the browser except the results.

import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { env } from '../../../config/env.js'

export type SourceState = 'ok' | 'unconfigured' | 'error'
export interface SourceStatus { state: SourceState; detail?: string }

export type Range = '7d' | '30d' | '90d'
export const RANGES: Range[] = ['7d', '30d', '90d']
export const rangeDays = (r: Range) => ({ '7d': 7, '30d': 30, '90d': 90 })[r]

// ---- Cache ------------------------------------------------------------------
// Fifteen minutes. The page is opened by one owner a few times a day; the
// APIs behind it have quotas (GA4: 25k tokens/day on the free tier, PostHog:
// an hourly read budget). Cached per key, errors are NOT cached.

const TTL_MS = 15 * 60 * 1000
const cache = new Map<string, { at: number; value: unknown }>()

export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T
  const value = await fn()
  cache.set(key, { at: Date.now(), value })
  return value
}

/** Test hook. */
export function clearAnalyticsCache(): void {
  cache.clear()
}

// ---- Google Analytics 4 -----------------------------------------------------

interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }

function loadServiceAccount(): ServiceAccount | null {
  const raw = env.GA4_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) return null
  try {
    // Either the JSON itself, or a path to the downloaded key file.
    const text = raw.startsWith('{') ? raw : readFileSync(raw, 'utf8')
    const sa = JSON.parse(text) as ServiceAccount
    return sa.client_email && sa.private_key ? sa : null
  } catch {
    return null
  }
}

export function ga4Configured(): boolean {
  return Boolean(env.GA4_PROPERTY_ID && loadServiceAccount())
}

let gaToken: { value: string; exp: number } | null = null

const b64url = (s: Buffer | string) => Buffer.from(s).toString('base64url')

/** Service-account JWT → OAuth2 access token (RFC 7523), cached until expiry. */
async function googleAccessToken(): Promise<string> {
  if (gaToken && gaToken.exp > Date.now() + 60_000) return gaToken.value
  const sa = loadServiceAccount()
  if (!sa) throw new Error('GA4 service account not configured')
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = signer.sign(sa.private_key).toString('base64url')
  const assertion = `${header}.${claims}.${signature}`

  const res = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`)
  const body = (await res.json()) as { access_token: string; expires_in: number }
  gaToken = { value: body.access_token, exp: Date.now() + body.expires_in * 1000 }
  return gaToken.value
}

export interface GaRow { dims: string[]; metrics: number[] }

export interface GaReportRequest {
  dimensions: string[]
  metrics: string[]
  range: Range
  /** eventName IN (...) */
  events?: string[]
  limit?: number
  orderByMetricDesc?: string
}

/** One runReport call, flattened to rows of strings + numbers. */
export async function ga4Report(req: GaReportRequest): Promise<GaRow[]> {
  const token = await googleAccessToken()
  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: `${rangeDays(req.range)}daysAgo`, endDate: 'today' }],
    dimensions: req.dimensions.map((name) => ({ name })),
    metrics: req.metrics.map((name) => ({ name })),
    limit: req.limit ?? 250,
    keepEmptyRows: false,
  }
  if (req.events?.length) {
    body.dimensionFilter = { filter: { fieldName: 'eventName', inListFilter: { values: req.events } } }
  }
  if (req.orderByMetricDesc) {
    body.orderBys = [{ metric: { metricName: req.orderByMetricDesc }, desc: true }]
  }
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GA4 runReport failed (${res.status}) ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]
  }
  return (data.rows ?? []).map((r) => ({
    dims: r.dimensionValues.map((d) => d.value),
    metrics: r.metricValues.map((m) => Number(m.value) || 0),
  }))
}

// ---- PostHog ----------------------------------------------------------------

export function posthogConfigured(): boolean {
  return Boolean(env.POSTHOG_PROJECT_ID && env.POSTHOG_PERSONAL_API_KEY)
}

async function posthogQuery<T>(query: Record<string, unknown>, name: string): Promise<T> {
  const host = (env.POSTHOG_HOST ?? 'https://eu.posthog.com').replace(/\/$/, '')
  const res = await fetch(`${host}/api/projects/${env.POSTHOG_PROJECT_ID}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.POSTHOG_PERSONAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, name, refresh: 'blocking' }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PostHog query failed (${res.status}) ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** HogQL rows. */
export async function posthogSql(sql: string, name: string): Promise<unknown[][]> {
  const data = await posthogQuery<{ results: unknown[][] }>({ kind: 'HogQLQuery', query: sql }, name)
  return data.results ?? []
}

export interface FunnelStep { name: string; count: number }

/** Ordered funnel: users who did step 1, then 2, then 3 within the window. */
export async function posthogFunnel(events: string[], range: Range, name: string): Promise<FunnelStep[]> {
  const data = await posthogQuery<{ results: { name: string; count: number }[] }>({
    kind: 'FunnelsQuery',
    dateRange: { date_from: `-${rangeDays(range)}d` },
    series: events.map((event) => ({ kind: 'EventsNode', event })),
    funnelsFilter: { funnelWindowInterval: 30, funnelWindowIntervalUnit: 'day' },
  }, name)
  return (data.results ?? []).map((s) => ({ name: s.name, count: s.count }))
}

// ---- Sentry -----------------------------------------------------------------

export function sentryConfigured(): boolean {
  return Boolean(env.SENTRY_API_TOKEN && env.SENTRY_ORG)
}

async function sentryGet<T>(path: string): Promise<T> {
  const base = (env.SENTRY_API_URL ?? 'https://sentry.io').replace(/\/$/, '')
  const res = await fetch(`${base}/api/0${path}`, {
    headers: { Authorization: `Bearer ${env.SENTRY_API_TOKEN}` },
  })
  if (!res.ok) throw new Error(`Sentry API failed (${res.status}) for ${path}`)
  return (await res.json()) as T
}

export interface SentryIssue {
  id: string
  title: string
  culprit: string
  count: number
  userCount: number
  lastSeen: string
  level: string
  permalink: string
  project: string
}

export async function sentryIssues(projectSlug: string, statsPeriod: '24h' | '7d' | '30d'): Promise<SentryIssue[]> {
  const q = new URLSearchParams({ query: 'is:unresolved', statsPeriod, sort: 'freq', limit: '10' })
  const rows = await sentryGet<{
    id: string; title: string; culprit: string; count: string; userCount: number; lastSeen: string; level: string; permalink: string
  }[]>(`/projects/${env.SENTRY_ORG}/${projectSlug}/issues/?${q}`)
  return rows.map((r) => ({
    id: r.id, title: r.title, culprit: r.culprit, count: Number(r.count) || 0, userCount: r.userCount ?? 0,
    lastSeen: r.lastSeen, level: r.level, permalink: r.permalink, project: projectSlug,
  }))
}

/** Errors per day across the organisation (both projects). */
export async function sentryErrorsPerDay(days: number): Promise<{ date: string; count: number }[]> {
  const q = new URLSearchParams({ field: 'sum(quantity)', category: 'error', interval: '1d', statsPeriod: `${days}d`, outcome: 'accepted' })
  const data = await sentryGet<{ intervals: string[]; groups: { series: Record<string, number[]> }[] }>(
    `/organizations/${env.SENTRY_ORG}/stats_v2/?${q}`,
  )
  const series = data.groups?.[0]?.series?.['sum(quantity)'] ?? []
  return (data.intervals ?? []).map((iso, i) => ({ date: iso.slice(0, 10), count: series[i] ?? 0 }))
}
