// ACTIVITY-LOG (23 Nov 2026, owner: "we need to add more things in user
// analytics … what exactly users are doing"). POST /api/activity — the app
// sends what a signed-in COACH or CLUB account does (the product events it
// already names, and the screens it opens), in small batches.
//
// Privacy (owner's choice: "coaches only, policy updated"):
//   - players and parents are never recorded: refused here, whatever the
//     browser sends (the app does not send for them either);
//   - nothing personal is stored: an event name, a few short values (format,
//     quality …) and the screen with its ids taken out;
//   - rows go with the account (ON DELETE CASCADE) and after 13 months
//     (jobs/activity-retention).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../config/database.js'
import { authGuard } from '../../middleware/auth-guard.js'

export const ACTIVITY_BATCH_MAX = 25
const EVENT = /^[a-z][a-z0-9_]{1,59}$/
const PropValue = z.union([z.string().max(80), z.number().finite(), z.boolean()])
const Item = z.object({
  event: z.string().regex(EVENT, 'Event names are lower_snake_case'),
  props: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/), PropValue).optional()
    .refine((p) => !p || Object.keys(p).length <= 12, 'At most 12 values'),
  /** The screen, ids already taken out by the app ("/sessions/:id"). */
  path: z.string().max(120).regex(/^\/[A-Za-z0-9/_:.-]*$/).optional(),
  /** When it happened on the device (ms epoch); trusted only within the last 15 minutes. */
  at: z.number().int().optional(),
})
const Body = z.object({ events: z.array(Item).min(1).max(ACTIVITY_BATCH_MAX) })

/** Only coach and club accounts are recorded. */
export const RECORDED_ACCOUNTS = new Set(['coach', 'club'])

export async function activityRoutes(app: FastifyInstance) {
  app.post('/', {
    preHandler: authGuard,
    // A busy coach sends a batch every few seconds at most; production numbers
    // stay strict, non-production loose for local end-to-end runs.
    config: { rateLimit: { max: process.env.NODE_ENV === 'production' ? 120 : 10_000, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const userId = (request.user as { sub: number }).sub
    const { events } = Body.parse(request.body)
    const user = await db.user.findUnique({ where: { id: userId }, select: { accountType: true, role: true } })
    // Not recorded: players and parents, and the owner's own testing (it would
    // read as a very busy coach). Said quietly, never an error.
    if (!user || !RECORDED_ACCOUNTS.has(user.accountType) || user.role === 'owner') return reply.status(202).send({ recorded: 0 })
    const now = Date.now()
    await db.activityEvent.createMany({
      data: events.map((e) => ({
        userId,
        event: e.event,
        props: e.props ?? undefined,
        path: e.path ?? null,
        createdAt: new Date(e.at && e.at <= now && now - e.at <= 15 * 60_000 ? e.at : now),
      })),
    })
    return reply.status(202).send({ recorded: events.length })
  })
}
