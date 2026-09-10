// Coach branding routes.
//
//   GET    /api/coach/:slug            public — the coach's page (404 unless live)
//   GET    /api/coach/me/branding      brand kit + go-live checklist
//   PATCH  /api/coach/me/branding      slug / colour / bio / title / enabled
//   POST   /api/coach/me/photo         headshot upload (multipart)
//   DELETE /api/coach/me/photo
//
// "me" is matched before ":slug" (registered first, and it's a reserved slug).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { db } from '../../config/database.js'
import { uploadToS3, deleteFromS3, presignUrl } from '../../config/s3.js'
import { readUpload } from '../../lib/multipart.js'
import { COACH_SLUG_RE, COACH_SLUG_RESERVED, getBrandKit, getCoachPage } from './coach-page.service.js'

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
}
