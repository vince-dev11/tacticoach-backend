import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'

/**
 * Detect Zod validation errors structurally rather than with `instanceof`
 * alone — when 'zod' is loaded twice (dual ESM/CJS resolution, test runners,
 * bundlers) `instanceof` fails silently and validation errors would surface
 * as 500s instead of 422s.
 */
function isZodError(error: unknown): error is ZodError {
  if (error instanceof ZodError) return true
  // Zod 4's ZodError does not extend the native Error class, so check shape.
  const e = error as { name?: string; issues?: unknown } | null
  return !!e && e.name === 'ZodError' && Array.isArray(e.issues)
}

export function errorHandler(error: FastifyError, _req: FastifyRequest, reply: FastifyReply) {
  if (isZodError(error)) {
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of error.issues) {
      const key = issue.path.join('.') || '_root'
      ;(fieldErrors[key] ??= []).push(issue.message)
    }
    return reply.status(422).send({
      statusCode: 422,
      error: 'Validation Error',
      issues: fieldErrors,
    })
  }

  const status = error.statusCode ?? 500
  if (status >= 500) {
    console.error(error)
  }

  // Unexpected 500s must not leak internals (Prisma/driver messages can name
  // tables, hosts or queries). Deliberate 5xx errors thrown by our routes
  // (502 "AI generation failed", 503 "not configured") keep their curated,
  // user-facing messages.
  const message = status === 500 ? 'Internal Server Error' : (error.message ?? 'Internal Server Error')

  reply.status(status).send({
    statusCode: status,
    error: status === 500 ? 'Internal Server Error' : (error.name ?? 'Error'),
    message,
  })
}
