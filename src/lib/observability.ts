// Observability helpers — the only place the rest of the API talks to Sentry.
//
// Every function is safe to call whether or not Sentry is configured: without
// SENTRY_DSN, Sentry.isEnabled() is false and these are no-ops. Route code
// never imports @sentry/node directly, so swapping the vendor later touches
// this file and instrument.ts only.
//
// The thread that ties everything together is the REQUEST ID:
//   - generated per request (or taken from the browser's X-Request-Id),
//   - written on every Fastify log line as `reqId`,
//   - returned to the browser in the X-Request-Id response header and in the
//     body of every 5xx response as `requestId`,
//   - attached to the Sentry event as the `request_id` tag.
// So a coach's "it said error ref 7f3a…", a pm2 log line and a Sentry issue
// all point at the same request.

import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import * as Sentry from '@sentry/node'

/** Accept a client-supplied request ID only if it looks like one. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/

/** Fastify `genReqId`: reuse the browser's ID when sane, otherwise mint one. */
export function genRequestId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const incoming = req.headers['x-request-id']
  const value = Array.isArray(incoming) ? incoming[0] : incoming
  return value && VALID_REQUEST_ID.test(value) ? value : randomUUID()
}

export function isMonitoringEnabled(): boolean {
  return Sentry.isEnabled()
}

/** The signed-in account's numeric ID, if an auth guard has run. */
function userIdOf(request?: FastifyRequest): number | undefined {
  const sub = (request?.user as { sub?: unknown } | undefined)?.sub
  return typeof sub === 'number' ? sub : undefined
}

export interface CaptureContext {
  request?: FastifyRequest
  /** Where it happened when there is no request: 'job:trial-reminders', 'boot'. */
  source?: string
  /** Searchable key/values (strings only — Sentry indexes these). */
  tags?: Record<string, string>
  /** Free-form detail shown on the event (scrubbed before sending). */
  extra?: Record<string, unknown>
  level?: 'fatal' | 'error' | 'warning'
}

/**
 * Report an error. Returns the Sentry event ID (or undefined when disabled).
 *
 * Adds: request ID, method, route pattern (`/api/clubs/:id`, not the raw URL,
 * so issues group by endpoint), status, user ID, and anything in `ctx`.
 */
export function captureError(error: unknown, ctx: CaptureContext = {}): string | undefined {
  if (!Sentry.isEnabled()) return undefined
  return Sentry.withScope((scope) => {
    const req = ctx.request
    if (req) {
      scope.setTag('request_id', String(req.id))
      scope.setTag('http.method', req.method)
      const route = req.routeOptions?.url
      if (route) {
        scope.setTag('route', route)
        scope.setTransactionName(`${req.method} ${route}`)
      }
      const userId = userIdOf(req)
      if (userId !== undefined) scope.setUser({ id: String(userId) })
    }
    if (ctx.source) scope.setTag('source', ctx.source)
    for (const [k, v] of Object.entries(ctx.tags ?? {})) scope.setTag(k, v)
    if (ctx.extra) scope.setExtras(ctx.extra)
    if (ctx.level) scope.setLevel(ctx.level)
    return Sentry.captureException(error)
  })
}

/** Send anything still queued — call before a deliberate process exit. */
export async function flushMonitoring(timeoutMs = 2000): Promise<void> {
  if (!Sentry.isEnabled()) return
  await Sentry.flush(timeoutMs)
}
