import type { FastifyRequest, FastifyReply } from 'fastify'
import { blockedUntilVerified } from '../lib/email-verify-gate.js'

/**
 * Bearer-token guard for authenticated routes.
 *
 * Verifying the signature is not enough on its own. Every token this API mints
 * is signed by the same instance, so a *refresh* token (30 days) or an
 * *email-verification* token (24h, and it travels in a URL — inbox, browser
 * history, referrer headers, server logs) would otherwise sail through
 * `jwtVerify()` and authenticate the request as that user. Only access tokens
 * may authorise a request, so anything carrying a `type` claim is rejected
 * here: access tokens are the one kind minted without one.
 */
const NON_ACCESS_TOKEN_TYPES = new Set(['refresh', 'verify-email'])

export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply
      .status(401)
      .send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired token' })
  }

  const type = (request.user as { type?: string } | undefined)?.type
  if (type && NON_ACCESS_TOKEN_TYPES.has(type)) {
    return reply
      .status(401)
      .send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired token' })
  }

  // VERIFY-GATE (16 Oct 2026): an account that still has to verify its email
  // may look around but not do anything (lib/email-verify-gate.ts).
  const sub = (request.user as { sub?: number } | undefined)?.sub
  if (sub && (await blockedUntilVerified(sub, request.method, request.url))) {
    return reply.status(403).send({
      statusCode: 403,
      error: 'email_unverified',
      code: 'EMAIL_UNVERIFIED',
      message: 'Please verify your email address to continue. We sent you a link — you can ask for a new one.',
    })
  }
}
