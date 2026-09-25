// Scrubbing for error reports — what must never leave the server.
//
// Separate from observability.ts so it has no Sentry import and can be unit
// tested as a plain function. Applied in Sentry's beforeSend to every event.
//
// The rule: an error report may say WHERE and WHAT failed, and WHICH account
// (by numeric ID). It may not carry anything that lets a reader act as a user —
// tokens, passwords, reset links, guardian links, auth headers, cookies.

const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|refresh|jwt|signature|card|cvc|iban/i

// JWTs (three base64url segments) and long opaque tokens in URLs or messages.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
// Query parameters whose value is a credential.
const QUERY_SECRET_RE = /([?&](?:token|code|key|signature|refreshToken|accessToken)=)[^&#\s]+/gi
// Path segments that ARE the credential: /feedback/guardian/<jwt>, /reset-password/<token>.
const PATH_TOKEN_RE = /(\/(?:guardian|reset-password|verify-email|invite|share)\/)[^/?#\s]{16,}/gi

export const REDACTED = '[redacted]'

export function scrubString(value: string): string {
  return value
    .replace(JWT_RE, REDACTED)
    .replace(QUERY_SECRET_RE, `$1${REDACTED}`)
    .replace(PATH_TOKEN_RE, `$1${REDACTED}`)
}

/** Deep-copy `value`, blanking secret-looking keys and scrubbing strings. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED
  if (typeof value === 'string') return scrubString(value)
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : scrubValue(v, depth + 1)
    }
    return out
  }
  return value
}

// Loose shape of a Sentry event — only the parts we touch.
interface ScrubbableEvent {
  message?: string
  request?: { url?: string; query_string?: unknown; headers?: Record<string, string>; cookies?: unknown; data?: unknown }
  exception?: { values?: { value?: string }[] }
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[]
  extra?: Record<string, unknown>
  contexts?: Record<string, unknown>
  user?: { id?: string | number; email?: string; ip_address?: string; username?: string }
}

export function scrubEvent<T>(event: T): T {
  const e = event as ScrubbableEvent
  if (e.message) e.message = scrubString(e.message)

  if (e.request) {
    if (e.request.url) e.request.url = scrubString(e.request.url)
    if (e.request.query_string) e.request.query_string = scrubValue(e.request.query_string)
    if (e.request.headers) e.request.headers = scrubValue(e.request.headers) as Record<string, string>
    // Bodies can hold passwords, player notes, children's names. Never sent.
    delete e.request.cookies
    delete e.request.data
  }

  for (const ex of e.exception?.values ?? []) {
    if (ex.value) ex.value = scrubString(ex.value)
  }

  for (const b of e.breadcrumbs ?? []) {
    if (b.message) b.message = scrubString(b.message)
    if (b.data) b.data = scrubValue(b.data) as Record<string, unknown>
  }

  if (e.extra) e.extra = scrubValue(e.extra) as Record<string, unknown>
  if (e.contexts) e.contexts = scrubValue(e.contexts) as Record<string, unknown>

  // Account ID only. Email, username and IP address are dropped even if set.
  if (e.user) e.user = e.user.id !== undefined ? { id: e.user.id } : {}

  return event
}
