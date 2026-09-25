// Coach branding routes.
//
//   GET    /api/coach/:slug            public — the coach's page (404 unless live)
//   GET    /api/coach/me/branding      brand kit + go-live checklist
//   PATCH  /api/coach/me/branding      slug / colour / bio / title / enabled
//   POST   /api/coach/me/photo         headshot upload (multipart)
//   DELETE /api/coach/me/photo
//   POST   /api/coach/:slug/contact    public — relay a message to the coach (opt-in)
//
// "me" is matched before ":slug" (registered first, and it's a reserved slug).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { db } from '../../config/database.js'
import { uploadToS3, deleteFromS3, presignUrl } from '../../config/s3.js'
import { readUpload } from '../../lib/multipart.js'
import { isMailConfigured, sendMail } from '../../config/mailer.js'
import { buildCoachContactEmail } from '../../lib/emails.js'
import { COACH_SLUG_RE, COACH_SLUG_RESERVED, getBrandKit, getCoachPage } from './coach-page.service.js'
import { captureError } from '../../lib/observability.js'

const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const PHOTO_MAX = 3 * 1024 * 1024 // 3 MB

const BrandKitSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(60)
    .regex(COACH_SLUG_RE, 'Lowercase letters, numbers and hyphens only')
    .optional()
    .nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  bio: z.string().max(600).optional().nullable(),
  title: z.string().max(80).optional().nullable(),
  enabled: z.boolean().optional(),
  coachingSince: z.number().int().min(1950).max(new Date().getFullYear()).optional().nullable(),
  qualifications: z.string().trim().max(160).optional().nullable(),
  philosophy: z.string().trim().max(200).optional().nullable(),
  location: z.string().trim().max(120).optional().nullable(),
  contactEnabled: z.boolean().optional(),
})

const ContactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255),
  message: z.string().trim().min(10).max(2000),
  // Honeypot — real forms leave it blank; see collaborations for the reasoning.
  website: z.string().max(0).optional(),
})

export async function coachPageRoutes(app: FastifyInstance) {
  // ---- Own brand kit (auth) -------------------------------------------------

  app.get('/me/branding', { preHandler: authGuard }, async (request, reply) => {
    const userId = (request.user as { sub: number }).sub
    const kit = await getBrandKit(userId)
    if (!kit) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })
    return reply.send(kit)
  })

  app.patch('/me/branding', { preHandler: authGuard }, async (request, reply) => {
    const userId = (request.user as { sub: number }).sub
    const input = BrandKitSchema.parse(request.body)

    if (input.slug) {
      if (COACH_SLUG_RESERVED.has(input.slug)) {
        return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'That address is reserved — pick another' })
      }
      const clash = await db.user.findFirst({ where: { coachSlug: input.slug, id: { not: userId } }, select: { id: true } })
      if (clash) {
        return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'That address is already taken' })
      }
    }

    await db.user.update({
      where: { id: userId },
      data: {
        ...(input.slug !== undefined && { coachSlug: input.slug }),
        ...(input.color !== undefined && { coachColor: input.color }),
        ...(input.bio !== undefined && { coachBio: input.bio }),
        ...(input.title !== undefined && { coachTitle: input.title }),
        ...(input.enabled !== undefined && { coachPageEnabled: input.enabled }),
        ...(input.coachingSince !== undefined && { coachingSince: input.coachingSince }),
        ...(input.qualifications !== undefined && { coachQualifications: input.qualifications || null }),
        ...(input.philosophy !== undefined && { coachPhilosophy: input.philosophy || null }),
        ...(input.location !== undefined && { coachLocation: input.location || null }),
        ...(input.contactEnabled !== undefined && { coachContactEnabled: input.contactEnabled }),
      },
    })
    return reply.send(await getBrandKit(userId))
  })

  app.post('/me/photo', { preHandler: authGuard }, async (request, reply) => {
    const userId = (request.user as { sub: number }).sub
    const existing = await db.user.findUnique({ where: { id: userId }, select: { coachPhotoKey: true } })
    const file = await readUpload(request, { maxBytes: PHOTO_MAX, allowedTypes: PHOTO_TYPES })
    if (existing?.coachPhotoKey) await deleteFromS3(existing.coachPhotoKey).catch(() => {/* best-effort */})
    const ext = file.mimetype === 'image/webp' ? 'webp' : file.mimetype === 'image/png' ? 'png' : 'jpg'
    const key = `coaches/${userId}/photo-${Date.now()}.${ext}`
    await uploadToS3(key, file.buffer, file.mimetype)
    await db.user.update({ where: { id: userId }, data: { coachPhotoKey: key } })
    return reply.send({ photoUrl: await presignUrl(key) })
  })

  app.delete('/me/photo', { preHandler: authGuard }, async (request, reply) => {
    const userId = (request.user as { sub: number }).sub
    const existing = await db.user.findUnique({ where: { id: userId }, select: { coachPhotoKey: true } })
    if (existing?.coachPhotoKey) {
      await deleteFromS3(existing.coachPhotoKey).catch(() => {/* best-effort */})
      await db.user.update({ where: { id: userId }, data: { coachPhotoKey: null } })
    }
    return reply.status(204).send()
  })

  // ---- Public page ----------------------------------------------------------

  app.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const page = await getCoachPage(slug)
    if (!page) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Coach page not found' })
    }
    return reply.send(page)
  })

  // Relay a visitor's message to the coach. The coach's email never appears
  // in any response: the page only says whether the button exists, and this
  // endpoint answers the same 200 whether or not mail actually went out to a
  // coach who has since switched contact off (no probing for state).
  app.post('/:slug/contact', { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const input = ContactSchema.parse(request.body)
    const page = await getCoachPage(slug)
    if (!page) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Coach page not found' })
    }
    if (!page.contactEnabled) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'This coach is not accepting messages' })
    }
    const coach = await db.user.findFirst({ where: { coachSlug: slug }, select: { id: true, email: true, name: true } })
    if (!coach) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Coach page not found' })
    if (!isMailConfigured()) {
      return reply.status(503).send({ statusCode: 503, error: 'Service Unavailable', message: 'Messaging is temporarily unavailable' })
    }
    try {
      await sendMail({ ...buildCoachContactEmail({ to: coach.email, coachName: coach.name, ...input }), kind: 'coach_contact', userId: coach.id })
    } catch (err) {
      request.log.error({ err }, 'Failed to relay coach contact message')
      captureError(err, { request, tags: { step: 'relay-coach-contact' } })
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'We could not deliver your message. Please try again later.' })
    }
    return reply.send({ ok: true })
  })
}
