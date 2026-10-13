// FAMILY (12 Oct 2026) — /api/family: the parent's page and the invitation.
//
// The invitation routes are public (the token in the parent's email is the
// proof). Everything else is a logged-in parent acting on THEIR OWN children:
// every child route goes through the service's active-link check.

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import {
  FamilyError, acceptPending, addChild, answerBookRequest, answerCoachRequest, answerInvite, childChangeEmail, childClose, childEnableLogin,
  childResetPassword, familyOverview, inviteInfo,
} from './family.service.js'

const userId = (request: { user?: unknown }) => (request.user as { sub: number }).sub
const fail = (reply: FastifyReply, err: unknown) => {
  if (err instanceof FamilyError) return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.code, message: err.message })
  throw err
}

export async function familyRoutes(app: FastifyInstance) {
  // ---- Public: the invitation ------------------------------------------------
  app.get('/invite/:token', { config: { rateLimit: { max: 60, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const info = await inviteInfo((request.params as { token: string }).token)
    return info
      ? reply.send(info)
      : reply.status(404).send({ statusCode: 404, error: 'invite_gone', message: 'This invitation has expired or was already answered.' })
  })

  app.post('/invite/:token', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const input = z.object({ accept: z.boolean(), password: z.string().min(8).max(200).optional().nullable() }).parse(request.body)
    try {
      return reply.send(await answerInvite((request.params as { token: string }).token, input))
    } catch (err) { return fail(reply, err) }
  })

  // ---- The parent, signed in ---------------------------------------------------
  await app.register(async (secure) => {
    secure.addHook('preHandler', authGuard)
    const id = (request: { params: unknown }) => Number((request.params as { id: string }).id)

    secure.get('/', async (request, reply) => reply.send(await familyOverview(userId(request))))

    secure.post('/links/:id/accept', async (request, reply) => {
      try { return reply.send(await acceptPending(userId(request), id(request))) } catch (err) { return fail(reply, err) }
    })
    // FAMILY-SIGNUP: POST /family/children { name, surname, dateOfBirth } — a parent adds their child.
    secure.post('/children', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request, reply) => {
      const input = z.object({
        name: z.string().trim().min(1).max(100),
        surname: z.string().trim().max(100).default(''),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }).parse(request.body)
      try { return reply.status(201).send(await addChild(userId(request), input)) } catch (err) { return fail(reply, err) }
    })
    // FAMILY-LINK: POST /family/coach-requests/:id { childId | null } — which child this coach coaches, or no.
    secure.post('/coach-requests/:id', async (request, reply) => {
      const { childId } = z.object({ childId: z.number().int().positive().nullable() }).parse(request.body)
      try { return reply.send(await answerCoachRequest(userId(request), id(request), childId)) } catch (err) { return fail(reply, err) }
    })
    secure.post('/children/:id/reset-password', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
      try { return reply.send(await childResetPassword(userId(request), id(request))) } catch (err) { return fail(reply, err) }
    })
    secure.patch('/children/:id/email', async (request, reply) => {
      const { email } = z.object({ email: z.string().trim().email().max(191) }).parse(request.body)
      try { return reply.send(await childChangeEmail(userId(request), id(request), email)) } catch (err) { return fail(reply, err) }
    })
    secure.post('/children/:id/login', async (request, reply) => {
      const { email } = z.object({ email: z.string().trim().email().max(191) }).parse(request.body)
      try { return reply.send(await childEnableLogin(userId(request), id(request), email)) } catch (err) { return fail(reply, err) }
    })
    secure.delete('/children/:id', async (request, reply) => {
      try { return reply.send(await childClose(userId(request), id(request))) } catch (err) { return fail(reply, err) }
    })
    secure.patch('/requests/:id', async (request, reply) => {
      const { status } = z.object({ status: z.enum(['done', 'dismissed']) }).parse(request.body)
      try { return reply.send(await answerBookRequest(userId(request), id(request), status)) } catch (err) { return fail(reply, err) }
    })
  })
}
