// Blocks editor actions (creating/updating boards, uploading media) for users
// whose trial has expired and who have no active subscription — free logins
// can still browse the library and gallery, they just can't create.
//
// Must run AFTER authGuard (needs request.user).

import type { FastifyRequest, FastifyReply } from 'fastify'
import { getEntitlements } from '../lib/entitlements.js'

export async function requireEditorAccess(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request.user as { sub: number } | undefined)?.sub
  if (!userId) {
    return reply
      .status(401)
      .send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired token' })
  }
  const entitlements = await getEntitlements(userId)
  if (!entitlements.editorAccess) {
    return reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Your free trial has ended. Choose a plan to keep using the editor.',
      code: 'NO_EDITOR_ACCESS',
    })
  }
}
