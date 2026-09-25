// In-process request statistics for Admin → Analytics → Health.
//
// A ring buffer of the last N requests (route, status, duration) and a
// monotonic event-loop lag sampler. No database, no dependency, restarts with
// the process — which is fine: the question it answers is "how is the API
// doing right now", not "how did it do last month" (that is Sentry's job).

import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks'

export interface Sample { at: number; route: string; method: string; status: number; ms: number }

const CAPACITY = 5000
const ring: Sample[] = new Array(CAPACITY)
let head = 0
let size = 0

export function recordRequest(s: Sample): void {
  ring[head] = s
  head = (head + 1) % CAPACITY
  if (size < CAPACITY) size += 1
}

/** Test hook. */
export function resetRequestStats(): void {
  head = 0
  size = 0
}

function samples(): Sample[] {
  const out: Sample[] = []
  for (let i = 0; i < size; i++) out.push(ring[(head - size + i + CAPACITY) % CAPACITY])
  return out
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return Math.round(sorted[idx] * 10) / 10
}

export interface RouteStat { route: string; count: number; p50: number; p95: number; max: number; errors5xx: number; errors4xx: number }

export interface RequestSummary {
  windowMinutes: number
  requests: number
  perMinute: number
  p50: number
  p95: number
  p99: number
  errorRate5xx: number
  routes: RouteStat[]
  slowest: RouteStat[]
}

/** Summary over the last `minutes` of traffic (default 60). */
export function requestSummary(minutes = 60, now = Date.now()): RequestSummary {
  const since = now - minutes * 60_000
  const recent = samples().filter((s) => s.at >= since)
  const all = recent.map((s) => s.ms).sort((a, b) => a - b)
  const byRoute = new Map<string, Sample[]>()
  for (const s of recent) {
    const key = `${s.method} ${s.route}`
    const list = byRoute.get(key) ?? []
    list.push(s)
    byRoute.set(key, list)
  }
  const routes: RouteStat[] = [...byRoute.entries()].map(([route, list]) => {
    const ms = list.map((s) => s.ms).sort((a, b) => a - b)
    return {
      route,
      count: list.length,
      p50: percentile(ms, 50),
      p95: percentile(ms, 95),
      max: ms[ms.length - 1] ?? 0,
      errors5xx: list.filter((s) => s.status >= 500).length,
      errors4xx: list.filter((s) => s.status >= 400 && s.status < 500).length,
    }
  })
  routes.sort((a, b) => b.count - a.count)
  const slowest = [...routes].filter((r) => r.count >= 3).sort((a, b) => b.p95 - a.p95).slice(0, 8)
  const errors = recent.filter((s) => s.status >= 500).length
  return {
    windowMinutes: minutes,
    requests: recent.length,
    perMinute: Math.round((recent.length / minutes) * 10) / 10,
    p50: percentile(all, 50),
    p95: percentile(all, 95),
    p99: percentile(all, 99),
    errorRate5xx: recent.length ? Math.round((errors / recent.length) * 1000) / 10 : 0,
    routes: routes.slice(0, 40),
    slowest,
  }
}

// ---- Event loop lag ---------------------------------------------------------------

let loopHist: IntervalHistogram | null = null

/** Start sampling (idempotent). Cheap: a 20 ms timer in the perf_hooks thread. */
export function startEventLoopMonitor(): void {
  if (loopHist) return
  loopHist = monitorEventLoopDelay({ resolution: 20 })
  loopHist.enable()
}

/** Lag in ms (p50/p95/max since the last reset), then reset for the next window. */
export function eventLoopLag(): { p50: number; p95: number; max: number } {
  if (!loopHist) return { p50: 0, p95: 0, max: 0 }
  const ns = (v: number) => Math.round((v / 1e6) * 10) / 10
  const out = { p50: ns(loopHist.percentile(50)), p95: ns(loopHist.percentile(95)), max: ns(loopHist.max) }
  loopHist.reset()
  return out
}
