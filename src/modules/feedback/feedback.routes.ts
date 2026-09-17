// Player feedback routes.
//
// Three audiences, three authorisation stories:
//
//   coach   — must own the squad row, OR be an admin of the club that coach
//             belongs to (lib/club-staff resolves which). Every query is
//             scoped to that set; no route takes an id and trusts it.
//             Linking a player is NOT widened — asking a child to connect
//             their account belongs to the coach who actually knows them.
//   player  — resolves their own roster rows from playerUserId. A player can
//             never pass an id and read someone else's notes.
//   guardian— a signed token scoped to one squad row, read-only, no account.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireEditorAccess } from '../../middleware/entitlement-guard.js'
import { db } from '../../config/database.js'
import { sendPlayerNoteEmail } from '../../lib/emails.js'
import { MAX_TAGS_PER_LIST, cleanTags } from '../../lib/feedback-tags.js'
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
  //
  // This route USED to sit above `app.addHook('preHandler', authGuard)` with a
  // comment claiming registration order kept it public. It did not. Fastify
  // hooks belong to an ENCAPSULATION CONTEXT, not to the lines that follow
  // them, and plugin bodies are deferred to ready() — so a hook added on this
  // instance reached every route in the plugin AND every child registered from
  // it, whatever the order. The link mailed to a parent, the one reader who by
  // definition has no account, answered 401 for its entire life.
  //
  // The fix is two SIBLING scopes: this one, which never sees the guard, and
  // the `secure` one below, which owns it. Nothing is public by being early;
  // it is public by being here.
  //
  // The test alongside this asserts 404-not-401 on a bad token, which is the
  // cheapest available proof that no auth ran.
  app.register(async (guardian) => {
    guardian.get('/guardian/:token', async (request, reply) => {
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

      // payload.sub is a SQUAD ROW id. It used to be minted from the note id
      // at the call site — a different table — so the number either matched no
      // row (404 for a parent holding a valid link) or, worse, matched an
      // unrelated child's row and showed a stranger their feedback. Whoever
      // signs one of these must pass squadPlayer.id; the token type is checked
      // above but a type cannot tell two ints apart.
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
              // boardId so a parent gets the animation too. Withholding it
              // from the one adult most likely to be impressed by it was an
              // oversight, not a policy.
              id: true, body: true, strengths: true, workOns: true, boardId: true, createdAt: true,
              // Named individually: a parent is entitled to know which adult
              // wrote to their child, and it is not always the squad's coach.
              coach: { select: { name: true, surname: true } },
              session: { select: { title: true, sessionDate: true } },
            },
          },
        },
      })
      if (!row) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Link not valid' })
      return reply.send(row)
    })
  })

  // Everything below is authenticated. The guard lives INSIDE this child
  // scope rather than on the plugin root, which is the whole point: a hook on
  // the root reaches every route in the plugin AND every child of it, however
  // the file is ordered, so the guardian route above could not be kept public
  // by registering it first, or by putting it in a scope of its own.
  //
  // Two siblings, one guarded, is the only arrangement Fastify will honour.
  await app.register(async (secure) => {
    secure.addHook('preHandler', authGuard)

    // ---- Coach: linking ------------------------------------------------------

    // GET /feedback/lookup?email= — exists or not, and nothing else.
    secure.get('/lookup', { preHandler: requireEditorAccess }, async (request, reply) => {
      const { email } = z.object({ email: z.string().email() }).parse(request.query)
      return reply.send({ exists: await playerAccountExists(email) })
    })

    // POST /feedback/squad/:id/link { email } — ask to link. Pending until the
    // player says yes.
    secure.post('/squad/:id/link', { preHandler: requireEditorAccess }, async (request, reply) => {
      const id = Number((request.params as { id: string }).id)
      const { email } = z.object({ email: z.string().email() }).parse(request.body)
      const result = await requestLink(userId(request), id, email)
      if (result.ok) return reply.send({ requested: true })

      const status = result.reason === 'not_yours' ? 404 : result.reason === 'no_account' ? 422 : 409
      return reply.status(status).send({ statusCode: status, error: 'Link failed', message: result.reason })
    })

    secure.delete('/squad/:id/link', async (request, reply) => {
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

    secure.get('/sessions/:id', { preHandler: requireEditorAccess }, async (request, reply) => {
      const id = Number((request.params as { id: string }).id)
      const roster = await rosterForSession(userId(request), id)
      return roster
        ? reply.send(roster)
        : reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Session not found' })
    })

    secure.post('/sessions/:id/notes', { preHandler: requireEditorAccess }, async (request, reply) => {
      const id = Number((request.params as { id: string }).id)
      const input = NoteSchema.parse(request.body)
      const result = await writeNote(userId(request), id, input)
      if (!result) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Player not found' })
      if ('notYours' in result) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Another coach has already written to this player for this session',
        })
      }
      if ('locked' in result) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'This note can no longer be changed',
        })
      }
      return reply.status(201).send(result.note)
    })

    secure.delete('/notes/:id', { preHandler: requireEditorAccess }, async (request, reply) => {
      const id = Number((request.params as { id: string }).id)
      return (await discardNote(userId(request), id))
        ? reply.send({ discarded: true })
        : reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Note not found' })
    })

    // POST /feedback/sessions/:id/send — deliver the batch.
    secure.post('/sessions/:id/send', { preHandler: requireEditorAccess }, async (request, reply) => {
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
          // Prisma hands these back as Json (unknown). cleanTags is the same
          // gate they went in through, so an email can never print a key that
          // the app itself would refuse to store.
          strengths: cleanTags(note.strengths),
          workOns: cleanTags(note.workOns),
          session: note.session
            ? { title: note.session.title, date: note.session.sessionDate ?? null }
            : null,
          digest: note.digest,
          boardId: note.boardId ?? null,
          // The SQUAD ROW, not the note. A guardian link is a standing view of
          // one child's record, so it has to outlive the note that introduced
          // it — signing note.id here is the bug the route above describes.
          guardianToken: note.squadPlayer.guardianEmail
            ? app.jwt.sign({ sub: note.squadPlayer.id, type: 'guardian' })
            : null,
        })
      }
      return reply.send({ sent: sent.length })
    })

    // ---- Player --------------------------------------------------------------

    secure.get('/links', async (request, reply) => reply.send(await linksForPlayer(userId(request))))

    secure.post('/links/:id/answer', async (request, reply) => {
      const id = Number((request.params as { id: string }).id)
      const { accept } = z.object({ accept: z.boolean() }).parse(request.body)
      return (await answerLink(userId(request), id, accept))
        ? reply.send({ ok: true })
        : reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Request not found' })
    })

    secure.get('/my-notes', async (request, reply) => reply.send(await notesForPlayer(userId(request))))

    secure.post('/my-notes/read', async (request, reply) => {
      const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(200) }).parse(request.body)
      await markNotesRead(userId(request), ids)
      return reply.send({ ok: true })
    })
  })
}
