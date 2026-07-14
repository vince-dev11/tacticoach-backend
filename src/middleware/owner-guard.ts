// Owner-only guard for the /api/admin area (blog CMS + CRM). Runs AFTER
// authGuard. The role is read from the DB on every request — roles are rare
// and security-critical, so we never trust a stale JWT claim.

import type { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../config/database.js'

export async function requireOwner(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request.user as { sub: number } | undefined)?.sub
  if (!userId) {
    return reply
      .status(401)
      .send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired token' })
  }
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role !== 'owner') {
    return reply
      .status(403)
      .send({ statusCode: 403, error: 'Forbidden', message: 'Admin access required' })
  }
}
