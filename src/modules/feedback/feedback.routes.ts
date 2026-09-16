// Player feedback routes.
//
// Three audiences, three authorisation stories:
//
//   coach   — must own the squad row. Every query is scoped by userId; there
//             is no route that takes an id and trusts it.
//   player  — resolves their own roster rows from playerUserId. A player can
//             never pass an id and read someone else's notes.
//   guardian— a signed token scoped to one squad row, read-only, no account.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireEditorAccess } from '../../middleware/entitlement-guard.js'
import { db } from '../../config/database.js'
import { sendPlayerNoteEmail } from '../../lib/emails.js'
import { MAX_TAGS_PER_LIST } from '../../lib/feedback-tags.js'
import {
  playerAccountExists,
  requestLink,
  linksForPlayer,
  answerLink,
  unlink,
  rosterForSession,
  writeNote,
  discardNote,
  sendSessionNotes,
  notesForPlayer,
  markNotesRead,
} from './feedback.service.js'

const userId = (request: { user: unknown }): number => (request.user as { sub: number }).sub

const TagList = z.array(z.string().max(40)).max(MAX_TAGS_PER_LIST).default([])

const NoteSchema = z.object({
  squadPlayerId: z.number().int().positive(),
  // Short on purpose — the tags carry the structure. See lib/feedback-tags.
  body: z.string().max(600).default(''),
  strengths: TagList,
  workOns: TagList,
  boardId: z.number().int().positive().optional().nullable(),
})

export async function feedbackRoutes(app: FastifyInstance) {
  // ---- Guardian: read-only, token, no account ------------------------------
  // Registered BEFORE the auth hook: a parent opening a link from their inbox
  // has no login and should never be asked for one.
  app.get('/guardian/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    let payload: { sub?: number; type?: string }
    try {
      payload = app.jwt.verify(token)
    } catch {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Link not valid' })
    }
    if (payload.type !== 'guardian' || !payload.sub) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Link not valid' })
    }

    const row = await db.squadPlayer.findFirst({
      // guardianEmail cleared = link revoked. The token stays valid forever
      // otherwise, because asking a parent to re-authenticate every month is
      // how you make sure they stop looking.
      where: { id: payload.sub, guardianEmail: { not: null } },
      select: {
        name: true,
        number: true,
        user: { select: { name: true, surname: true, clubName: true } },
        notes: {
          where: { sentAt: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, body: true, strengths: true, workOns: true, createdAt: true,
            session: { select: { title: true, sessionDate: true } },
          },
        },
      },
    })
    if (!row) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Link not valid' })
    return reply.send(row)
  })

  app.addHook('preHandler', authGuard)

  // ---- Coach: linking ------------------------------------------------------

  // GET /feedback/lookup?email= — exists or not, and nothing else.
  app.get('/lookup', { preHandler: requireEditorAccess }, async (request, reply) => {
    const { email } = z.object({ email: z.string().email() }).parse(request.query)
    return reply.send({ exists: await playerAccountExists(email) })
  })

  // POST /feedback/squad/:id/link { email } — ask to link. Pending until the
  // player says yes.
  app.post('/squad/:id/link', { preHandler: requireEditorAccess }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const { email } = z.object({ email: z.string().email() }).parse(request.body)
    const result = await requestLink(userId(request), id, email)
    if (result.ok) return reply.send({ requested: true })

    const status = result.reason === 'not_yours' ? 404 : result.reason === 'no_account' ? 422 : 409
    return reply.status(status).send({ statusCode: status, error: 'Link failed', message: result.reason })
  })

  app.delete('/squad/:id/link', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    // Either side may pull the link; whichever one is calling is the one that
    // has to match, so a coach cannot unlink someone else's player.
    const done =
      (await unlink(id, { coachId: userId(request) })) ||
      (await unlink(id, { playerUserId: userId(request) }))
    return done
      ? reply.send({ unlinked: true })
      : reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Link not found' })
  })

  // ---- Coach: writing ------------------------------------------------------

  app.get('/sessions/:id', { preHandler: requireEditorAccess }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const roster = await rosterForSession(userId(request), id)
    return roster
      ? reply.send(roster)
      : reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Session not found' })
  })

  app.post('/sessions/:id/notes', { preHandler: requireEditorAccess }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const input = NoteSchema.parse(request.body)
    const result = await writeNote(userId(request), id, input)
    if (!result) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Player not found' })
    if ('locked' in result) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'This note can no longer be changed',
      })
    }
    return reply.status(201).send(result.note)
  })

  app.delete('/notes/:id', { preHandler: requireEditorAccess }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    return (await discardNote(userId(request), id))
      ? reply.send({ discarded: true })
      : reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Note not found' })
  })

  // POST /feedback/sessions/:id/send — deliver the batch.
  app.post('/sessions/:id/send', { preHandler: requireEditorAccess }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const coachId = userId(request)
    const sent = await sendSessionNotes(coachId, id)

    const coach = await db.user.findUnique({
      where: { id: coachId },
      select: { name: true, surname: true, clubName: true },
    })

    // Emails are fire-and-forget: a note is delivered the moment it is stored.
    // Mail being slow or unconfigured must never make a coach think their
    // feedback did not save.
    for (const note of sent) {
      const player = note.squadPlayer.playerUser
      if (!player) continue
      void sendPlayerNoteEmail({
        to: player.email,
        cc: note.squadPlayer.guardianEmail,
        playerName: note.squadPlayer.name,
        coachName: [coach?.name, coach?.surname].filter(Boolean).join(' ') || 'Your coach',
        clubName: coach?.clubName ?? null,
        body: note.body,
        guardianToken: note.squadPlayer.guardianEmail
          ? app.jwt.sign({ sub: note.id, type: 'guardian' })
          : null,
      })
    }
    return reply.send({ sent: sent.length })
  })

  // ---- Player --------------------------------------------------------------

  app.get('/links', async (request, reply) => reply.send(await linksForPlayer(userId(request))))

  app.post('/links/:id/answer', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const { accept } = z.object({ accept: z.boolean() }).parse(request.body)
    return (await answerLink(userId(request), id, accept))
      ? reply.send({ ok: true })
      : reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Request not found' })
  })

  app.get('/my-notes', async (request, reply) => reply.send(await notesForPlayer(userId(request))))

  app.post('/my-notes/read', async (request, reply) => {
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(200) }).parse(request.body)
    await markNotesRead(userId(request), ids)
    return reply.send({ ok: true })
  })
}
