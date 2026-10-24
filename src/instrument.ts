// Error tracking — Sentry, started before anything else in the process.
//
// Imported as the FIRST line of src/index.ts, so Sentry is live before the app,
// the database client or any route module loads. That is enough for every
// error we report ourselves (the error handler, background jobs, crashes).
//
// For automatic performance tracing of HTTP/Fastify/Prisma as well, Node has
// to load this file before ANY module is linked, which only `--import` can do:
//
//   node --import ./dist/instrument.js dist/index.js
//   (pm2: node_args: "--import ./dist/instrument.js")
//
// Importing it twice is harmless: Sentry.init runs once (see the guard below).
//
// Everything is opt-in. Without SENTRY_DSN nothing is initialised and every
// helper in lib/observability.ts is a no-op, so development, tests and a
// server that has not been configured yet behave exactly as before.

import 'dotenv/config'
import * as Sentry from '@sentry/node'
import { scrubEvent } from './lib/observability-scrub.js'
import { shouldReportRequestError } from './lib/sentry-filter.js'

const dsn = process.env.SENTRY_DSN?.trim()
const nodeEnv = process.env.NODE_ENV ?? 'development'

/** Parse a 0..1 rate, falling back when unset or nonsense. */
function rate(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback
}

const globalFlag = globalThis as { __tcSentryInit?: boolean }

/**
 * SENTRY-PROD (24 Oct 2026, owner): Sentry registers errors from PRODUCTION
 * only. A DSN in a local .env no longer reports a developer's errors to the
 * live project; `NODE_ENV=production` is required, or SENTRY_FORCE=1 to test
 * the wiring deliberately from a dev process.
 */
export function shouldInitSentry(env: NodeJS.ProcessEnv): boolean {
  if (!env.SENTRY_DSN?.trim()) return false
  const node = env.NODE_ENV ?? 'development'
  if (node === 'test') return false
  if (/^(1|true)$/i.test(env.SENTRY_FORCE ?? '')) return true
  return node === 'production'
}

if (!shouldInitSentry(process.env) && dsn && nodeEnv !== 'test' && !globalFlag.__tcSentryInit) {
  console.info('[sentry] off: errors are only registered when NODE_ENV=production (SENTRY_FORCE=1 to test it).')
}

if (shouldInitSentry(process.env) && !globalFlag.__tcSentryInit) {
  globalFlag.__tcSentryInit = true
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? nodeEnv,
    // Set by the deploy (git SHA or version) so every error is pinned to the
    // exact build that threw it, and "resolved in next release" works.
    release: process.env.SENTRY_RELEASE || undefined,
    serverName: process.env.SENTRY_SERVER_NAME || undefined,

    // 10% of requests traced by default: enough to see slow endpoints without
    // spending the quota. Raise temporarily while chasing a performance issue.
    tracesSampleRate: rate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.1),

    // Never let the SDK attach IP addresses, cookies or request bodies on its
    // own. We add the user ID ourselves (never the email) — see observability.ts.
    sendDefaultPii: false,

    // Validation errors and 4xx answers are not faults (see sentry-filter.ts).
    integrations: [Sentry.fastifyIntegration({ shouldHandleError: (error) => shouldReportRequestError(error) })],

    // Last line of defence: strip tokens, passwords and auth headers from
    // anything that slipped into an event or breadcrumb.
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
  })
}
