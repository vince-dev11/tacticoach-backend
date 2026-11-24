// Weekly tactical challenge routes.
//
// Viewing is public on purpose (see share.routes.ts for the same pattern) —
// every submission is a published board a coach might share outside the app,
// and gating that behind login would kill the whole "free marketing" point
// of the feature. Entering and voting require an account: it stops one
// person casting unlimited votes, and it turns "I want to vote for this" into
// a signup moment instead of a dead end.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireOwner } from '../../middleware/owner-guard.js'
import { CreateChallengeSchema, SubmitBoardSchema } from './challenges.schema.js'
import {
  getActiveChallenge,
  listSubmissions,
  listWinners,
  listAllChallenges,
  enterChallenge,
  castVote,
  removeVote,
  ChallengeError,
} from './challenges.service.js'
import { db } from '../../config/database.js'

/** Best-effort auth: identifies the viewer when a valid token is present,
 *  but never rejects the request — these routes stay open to everyone. */
async function optionalUserId(request: FastifyRequest): Promise<number | undefined> {
  try {
    await request.jwtVerify()
    return (request.user as { sub: number }).sub
  } catch {
    return undefined
  }
}

export async function challengesRoutes(app: FastifyInstance) {
  // GET /challenges/current — this week's scenario + live leaderboard. Public.
  app.get('/current', async (request, reply) => {
    const viewerId = await optionalUserId(request)
    const challenge = await getActiveChallenge()
    if (!challenge) return reply.send({ challenge: null, submissions: [] })
    const submissions = await listSubmissions(challenge.id, viewerId)
    return reply.send({ challenge, submissions })
  })

  // GET /challenges/winners — closed challenges + their top-voted entry. Public.
  app.get('/winners', async (request, reply) => {
    const winners = await listWinners()
    return reply.send({ winners })
  })

  // POST /challenges/:id/submissions  { boardId } — enter (or swap your entry
  // in) the active challenge with one of your own published boards.
  app.post('/:id/submissions', { preHandler: authGuard }, async (request, reply) => {
    const userId = (request.user as { sub: number }).sub
    const { id } = request.params as { id: string }
    const { boardId } = SubmitBoardSchema.parse(request.body)
    try {
      const submission = await enterChallenge(Number(id), userId, boardId)
      return reply.status(201).send(submission)
    } catch (err) {
      if (err instanceof ChallengeError) {
        return reply.status(err.status).send({ statusCode: err.status, error: 'Bad Request', message: err.message })
      }
      throw err
    }
  })

  // POST /challenges/submissions/:submissionId/vote — one ballot per coach per
  // challenge. Returns the challenge's full, re-ranked submission list since a
  // vote here can move off another submission (its count changes too).
  app.post('/submissions/:submissionId/vote', { preHandler: authGuard }, async (request, reply) => {
    const userId = (request.user as { sub: number }).sub
    const { submissionId } = request.params as { submissionId: string }
    try {
      const submissions = await castVote(Number(submissionId), userId)
      return reply.send({ submissions })
    } catch (err) {
      if (err instanceof ChallengeError) {
        return reply.status(err.status).send({ statusCode: err.status, error: 'Bad Request', message: err.message })
      }
      throw err
    }
  })

  // DELETE /challenges/submissions/:submissionId/vote — retract a vote.
  app.delete('/submissions/:submissionId/vote', { preHandler: authGuard }, async (request, reply) => {
    const userId = (request.user as { sub: number }).sub
    const { submissionId } = request.params as { submissionId: string }
    const result = await removeVote(Number(submissionId), userId)
    return reply.send(result)
  })

  // ---- Owner-authored content ---------------------------------------------

  // GET /challenges — every challenge, with status + submission counts. Owner only.
  app.get('/', { preHandler: [authGuard, requireOwner] }, async (_request, reply) => {
    const challenges = await listAllChallenges()
    return reply.send({ challenges })
  })

  // POST /challenges — publish next week's scenario. Owner only.
  // CHALLENGE-DELETE (24 Nov 2026): the same title and start twice is a
  // double publish, never two challenges — refuse the second (409).
  app.post('/', { preHandler: [authGuard, requireOwner] }, async (request, reply) => {
    const input = CreateChallengeSchema.parse(request.body)
    const twin = await db.challenge.findFirst({ where: { title: input.title, startsAt: input.startsAt }, select: { id: true } })
    if (twin) {
      return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'This challenge is already published (same title and start).' })
    }
    const challenge = await db.challenge.create({ data: input })
    return reply.status(201).send(challenge)
  })

  // DELETE /challenges/:id — remove a challenge published by mistake. Owner
  // only. Its entries and votes go with it (cascade); the coaches' boards stay.
  app.delete('/:id', { preHandler: [authGuard, requireOwner] }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Challenge not found' })
    }
    const found = await db.challenge.findUnique({ where: { id }, select: { id: true, _count: { select: { submissions: true } } } })
    if (!found) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Challenge not found' })
    await db.challenge.delete({ where: { id } })
    return reply.send({ ok: true, removedEntries: found._count.submissions })
  })
}
