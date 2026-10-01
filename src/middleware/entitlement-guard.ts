// Blocks editor actions for anyone who may not open the editor at all.
//
// Refuses two kinds of account: players (403 — never theirs) and coaches whose
// 14-day free trial has ended (402 TRIAL_ENDED — theirs for a price). Every
// write route sits behind this and no read route does, which is exactly what
// "library only after the trial" means.
//
// What it no longer does is enforce PLAN limits. A free coach may open the
// editor and save boards — up to five of them. Those caps are counted in the
// services that create the rows, and answer 402 rather than 403, because
// "you've used your five" and "this is not for you" are different sentences
// and only one of them has a price attached.
//
// Must run AFTER authGuard (needs request.user).

import type { FastifyRequest, FastifyReply } from 'fastify'
import { getEntitlements } from '../lib/entitlements.js'
import { can, type Capability } from '../lib/capabilities.js'

export async function requireEditorAccess(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request.user as { sub: number } | undefined)?.sub
  if (!userId) {
    return reply
      .status(401)
      .send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired token' })
  }
  const entitlements = await getEntitlements(userId)
  // A coach whose 14-day free trial has ended: not forbidden, un-upgraded —
  // so 402, with a code the frontend turns into the "trial ended" dialog.
  if (!entitlements.editorAccess && entitlements.subscriptionStatus === 'free_expired') {
    return reply.status(402).send({
      statusCode: 402,
      error: 'Payment Required',
      message: 'Your 14-day free trial has ended. Your work is safe in the library — choose a plan to keep building.',
      code: 'TRIAL_ENDED',
    })
  }
  if (!entitlements.editorAccess) {
    return reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'This account cannot use the coach editor.',
      code: 'NO_EDITOR_ACCESS',
    })
  }
}

/**
 * Require one capability, for routes that gate on a feature rather than on
 * having an account.
 *
 * Needed the moment the free tier existed. Before it, `requireEditorAccess`
 * was a good enough proxy for "is a paying customer" and the AI routes leant
 * on it; afterwards every coach passes that guard, and the AI endpoint was one
 * `addHook` away from being free for everyone. Credits would still have read
 * zero, so the damage was bounded — but "a second, unrelated meter happened to
 * be zero" is not an access control.
 *
 *     app.addHook('preHandler', requireCapability('ai'))
 *
 * Answers 402, like every other plan limit, so one frontend handler turns all
 * of them into the same upgrade prompt.
 */
export function requireCapability(capability: Capability) {
  return async function guard(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request.user as { sub: number } | undefined)?.sub
    if (!userId) {
      return reply
        .status(401)
        .send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired token' })
    }
    if (!can(await getEntitlements(userId), capability)) {
      return reply.status(402).send({
        statusCode: 402,
        error: 'Payment Required',
        message: 'Your plan does not include this. Upgrade to unlock it.',
        code: 'CAPABILITY_REQUIRED',
        capability,
      })
    }
  }
}
