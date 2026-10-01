import type { FastifyInstance } from 'fastify'
import { authGuard } from '../../middleware/auth-guard.js'
import { CreateSquadSchema, MovePlayerSchema } from './users.schema.js'
import {
  listSquads, defaultSquad, createSquad, renameSquad, archiveSquad, movePlayer,
} from './squads.service.js'
import { type TourId, UpdateProfileSchema, TourDoneSchema, SaveSquadSchema, ALLOWED_LOGO_TYPES, EXT_FOR_LOGO_TYPE, MAX_LOGO_SIZE } from './users.schema.js'
import { getUserProfile, updateUserProfile, uploadClubLogo, deleteClubLogo, markTourDone, getSquad, saveSquad } from './users.service.js'
import { z } from 'zod'
import { requireCapability, requireEditorAccess } from '../../middleware/entitlement-guard.js'

// Squads come with a paid plan (decided 1 Oct 2026). Editor check first so a
// trial that has ended answers TRIAL_ENDED rather than "not on your plan".
const squadWrite = { preHandler: [requireEditorAccess, requireCapability('player_feedback')] }
import { becomeCoach, deleteAccount, changePassword, checkPassword, guardianEmailFor, setGuardianEmail, AccountError } from './account.service.js'

// Per-route limits override the global test relaxation (app.ts), so relax them here too.
const TEST = process.env.NODE_ENV === 'test'
// The per-route limits below are for production; a local end-to-end run
// changes passwords and deletes accounts far more often than a coach would.
const PROD = process.env.NODE_ENV === 'production'
const lim = (max: number) => (TEST ? 10_000 : PROD ? max : max * 100)

export async function usersRoutes(app: FastifyInstance) {
  // All routes require auth
  app.addHook('preHandler', authGuard)

  // GET /users/me
  app.get('/me', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const user = await getUserProfile(userId)
    if (!user) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })
    return reply.send(user)
  })

  // PATCH /users/me
  app.patch('/me', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const input = UpdateProfileSchema.parse(request.body)
    const user = await updateUserProfile(userId, input)
    return reply.send(user)
  })

  // POST /users/me/become-coach — "I signed up as a player by mistake".
  // Player → coach, with the same fresh trial a coach signup gets.
  app.post('/me/become-coach', { config: { rateLimit: { max: lim(5), timeWindow: '1 hour' } } }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    try {
      return reply.send(await becomeCoach(userId))
    } catch (err) {
      if (err instanceof AccountError) return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.code, message: err.message })
      throw err
    }
  })

  // POST /users/me/password { current, next } — change it from the profile.
  app.post('/me/password', { config: { rateLimit: { max: lim(5), timeWindow: '15 minutes' } } }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { current, next } = z.object({ current: z.string().min(1).max(128), next: z.string().min(8).max(128) }).parse(request.body)
    try {
      return reply.send(await changePassword(userId, current, next))
    } catch (err) {
      if (err instanceof AccountError) return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.code, message: err.message })
      throw err
    }
  })

  // POST /users/me/password/check { password } — is this my password? Lets
  // the delete-account form refuse a wrong password BEFORE the "delete for
  // good" confirmation, instead of after it (QA B-12).
  app.post('/me/password/check', { config: { rateLimit: { max: lim(10), timeWindow: '15 minutes' } } }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { password } = z.object({ password: z.string().min(1).max(128) }).parse(request.body)
    try {
      return reply.send(await checkPassword(userId, password))
    } catch (err) {
      if (err instanceof AccountError) return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.code, message: err.message })
      throw err
    }
  })

  // GET/PUT /users/me/guardian — a player's parent or guardian email.
  app.get('/me/guardian', async (request, reply) =>
    reply.send(await guardianEmailFor((request.user as any).sub as number)))
  app.put('/me/guardian', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { email } = z.object({ email: z.string().trim().email().max(191).nullable() }).parse(request.body)
    try {
      return reply.send(await setGuardianEmail(userId, email ? email.toLowerCase() : null))
    } catch (err) {
      if (err instanceof AccountError) return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.code, message: err.message })
      throw err
    }
  })

  // DELETE /users/me { password } — delete my account. Password first: this
  // cannot be undone, and a borrowed phone must not be able to do it.
  app.delete('/me', { config: { rateLimit: { max: lim(5), timeWindow: '15 minutes' } } }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { password } = z.object({ password: z.string().min(1).max(128) }).parse(request.body)
    try {
      return reply.send(await deleteAccount(userId, password))
    } catch (err) {
      if (err instanceof AccountError) return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.code, message: err.message })
      throw err
    }
  })

  // POST /users/me/tours — mark a guided tour as completed (idempotent).
  // Account-level so first-login tours show once per coach, not per browser.
  app.post('/me/tours', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { tour } = TourDoneSchema.parse(request.body)
    const toursDone = await markTourDone(userId, tour as TourId)
    return reply.send({ toursDone })
  })

  // ---- Squads --------------------------------------------------------------
  // A coach with one team never sees any of this; the client hides the picker
  // when the list has a single entry. Everything below still answers for that
  // coach, because `defaultSquad` makes their first squad on demand.

  // GET /users/me/squads — this coach's teams.
  app.get('/me/squads', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const squads = await listSquads(userId)
    // Never an empty list: an account that has never had players still gets
    // one squad, so the client has something to select.
    return reply.send({ squads: squads.length > 0 ? squads : [await defaultSquad(userId)] })
  })

  app.post('/me/squads', squadWrite, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const input = CreateSquadSchema.parse(request.body)
    return reply.status(201).send(await createSquad(userId, input.name, input.ageGroup ?? null))
  })

  app.patch('/me/squads/:id', squadWrite, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const id = Number((request.params as { id: string }).id)
    const input = CreateSquadSchema.partial().parse(request.body)
    return (await renameSquad(userId, id, input))
      ? reply.send({ ok: true })
      : reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Squad not found' })
  })

  app.delete('/me/squads/:id', squadWrite, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const id = Number((request.params as { id: string }).id)
    const result = await archiveSquad(userId, id)
    if (result.ok) return reply.status(204).send()
    // A coach with no squads at all would get one recreated on the next read,
    // which looks like the app undoing what they just did.
    const status = result.reason === 'last_one' ? 409 : 404
    return reply.status(status).send({ statusCode: status, error: 'Cannot archive', message: result.reason })
  })

  // POST /users/me/squad-players/:id/move { squadId } — promote a player.
  // One UPDATE: the row carries their account link and every note ever
  // written to them, so it must survive the move intact.
  app.post('/me/squad-players/:id/move', squadWrite, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const id = Number((request.params as { id: string }).id)
    const { squadId } = MovePlayerSchema.parse(request.body)
    return (await movePlayer(userId, id, squadId))
      ? reply.send({ ok: true })
      : reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Player or squad not found' })
  })

  // GET /users/me/squad?squadId= — one squad's players, in display order.
  app.get('/me/squad', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const squadId = Number((request.query as { squadId?: string }).squadId) || null
    const { squad, players } = await getSquad(userId, squadId)
    return reply.send({ squad, players })
  })

  // PUT /users/me/squad — replace-all save, scoped to ONE squad.
  app.put('/me/squad', squadWrite, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const input = SaveSquadSchema.parse(request.body)
    const { squad, players } = await saveSquad(userId, input.players, input.squadId ?? null)
    return reply.send({ squad, players })
  })

  // POST /users/me/logo — multipart upload
  app.post('/me/logo', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const data = await request.file()
    if (!data) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'No file uploaded' })
    }
    if (!ALLOWED_LOGO_TYPES.includes(data.mimetype)) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: `Allowed types: ${ALLOWED_LOGO_TYPES.join(', ')}` })
    }

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)

    if (buffer.length > MAX_LOGO_SIZE) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'File too large (max 5 MB)' })
    }

    // Derive the extension from the VALIDATED mime type, never from the
    // client-supplied filename: the filename is attacker-controlled, so
    // trusting it let a caller pick the stored object's extension (and with
    // it the content type it is later served as).
    const ext = EXT_FOR_LOGO_TYPE[data.mimetype] ?? 'png'
    const logoUrl = await uploadClubLogo(userId, buffer, data.mimetype, ext)
    return reply.send({ clubLogoUrl: logoUrl })
  })

  // DELETE /users/me/logo
  app.delete('/me/logo', async (request, reply) => {
    const userId = (request.user as any).sub as number
    await deleteClubLogo(userId)
    return reply.send({ message: 'Logo removed' })
  })
}
