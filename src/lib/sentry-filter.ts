// EMAIL-FAIL (14 Oct 2026): which request errors Sentry should see.
//
// On Fastify 5, Sentry's own integration catches handler errors from
// Fastify's diagnostics channel BEFORE our error handler has turned them into
// a response, so the reply still reads 200 and its default rule ("not 3xx or
// 4xx") reports everything — including a login form sent empty (a ZodError
// that becomes a 422). Those are the user's mistakes, answered with a clear
// message; they are not bugs. Decide from the error itself instead.
//
// No Sentry import, so it is a plain function the tests can call.

function isValidationError(error: unknown): boolean {
  const e = error as { name?: string; issues?: unknown } | null
  return !!e && e.name === 'ZodError' && Array.isArray(e.issues)
}

/** True when this request error is worth a Sentry event (a server fault). */
export function shouldReportRequestError(error: unknown): boolean {
  if (isValidationError(error)) return false
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  // Errors that carry a 4xx (401, 403, 404, 409, 429…) are answers, not faults.
  if (typeof status === 'number' && status < 500) return false
  return true
}
