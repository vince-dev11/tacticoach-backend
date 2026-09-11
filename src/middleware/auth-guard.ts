import type { FastifyRequest, FastifyReply } from 'fastify'

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
}
