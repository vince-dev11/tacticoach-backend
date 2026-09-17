// Refuses a player account anything outside the player product.
//
// Registered as a root-level onRequest hook in app.ts, which is what makes it
// deny-by-default: root hooks reach every route in every child scope, so a
// module added later is covered without its author knowing this file exists.
//
// It cannot read `request.user`. Root hooks run BEFORE the per-module
// authGuard that populates it, so this verifies the token itself. That is the
// price of running early enough to cover routes whose own guard is missing —
// and routes whose own guard is missing are the entire reason for the file.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../config/database.js'
import { playerMayCall } from '../lib/player-lockdown.js'

export function playerLockdown(app: FastifyInstance) {
  return async function playerGuard(request: FastifyRequest, reply: FastifyReply) {
    // Allowed paths cost nothing — no decode, no query. Player traffic is
    // almost entirely /api/feedback, so the common case exits here, and so
    // does every unauthenticated request to a public page.
    const path = request.url.split('?')[0]
    if (playerMayCall(path)) return

    const header = request.headers.authorization
    if (!header?.startsWith('Bearer ')) return // anonymous — the route's own guard decides

    let sub: number | undefined
    try {
      sub = (app.jwt.verify(header.slice(7)) as { sub?: number }).sub
    } catch {
      return // a bad token is the route guard's 401 to give, not ours
    }
    if (!sub) return

    // One indexed read on the primary key. It could be avoided by putting
    // accountType in the access token, and that is worth doing if this ever
    // shows up in a profile — but a claim minted at login goes stale, and a
    // stale claim on the guard that separates a child's account from an
    // adult's is the wrong thing to be clever about.
    const account = await db.user.findUnique({
      where: { id: sub },
      select: { accountType: true },
    })
    if (account?.accountType !== 'player') return

    // Deliberately not the NO_EDITOR_ACCESS / "choose a plan" message the
    // entitlement guard gives. Nothing is for sale here: no plan turns a
    // player account into a coach one, and inviting a child to buy their way
    // out of this would be both untrue and grubby.
    return reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'This part of TactiCoach is for coaches. Your feedback is at /my-football.',
      code: 'PLAYER_ACCOUNT',
    })
  }
}
