// Drill sheets ("data sheets") — publishable, likeable session sheets.
// The sheet's rendered image is stored in S3; `data` keeps the source
// configuration so the owner can re-open and edit it later.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireEditorAccess } from '../../middleware/entitlement-guard.js'
import { db } from '../../config/database.js'
import { uploadToS3, deleteFromS3, presignUrl } from '../../config/s3.js'
import { readUpload } from '../../lib/multipart.js'

const IMAGE_TYPES = ['image/webp', 'image/png', 'image/jpeg']
const IMAGE_MAX = 2 * 1024 * 1024 // 2 MB

const CreateSheetSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  data: z.unknown().optional(),
})

const UpdateSheetSchema = CreateSheetSchema.partial()

async function withImageUrl<T extends { imageKey?: string | null }>(
  sheet: T,
): Promise<T & { imageUrl: string | null }> {
  return { ...sheet, imageUrl: sheet.imageKey ? await presignUrl(sheet.imageKey) : null }
}

export async function drillSheetsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard)

  // GET /drill-sheets — my sheets
  app.get('/', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const sheets = await db.drillSheet.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { likes: true } } },
    })
    return reply.send(
      await Promise.all(
        sheets.map(async ({ _count, ...s }) => ({ ...(await withImageUrl(s)), likeCount: _count.likes })),
      ),
    )
  })

  // GET /drill-sheets/gallery — published sheets from all users, with likes
  app.get('/gallery', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { page = '1', limit = '20' } = request.query as Record<string, string>
    const skip = (Number(page) - 1) * Number(limit)
    const [sheets, total] = await Promise.all([
      db.drillSheet.findMany({
        where: { published: true },
        orderBy: { publishedAt: 'desc' },
        skip,
        take: Number(limit),
        include: {
          user: { select: { id: true, name: true, surname: true, clubName: true } },
          _count: { select: { likes: true } },
          likes: { where: { userId }, select: { id: true } },
        },
      }),
      db.drillSheet.count({ where: { published: true } }),
    ])
    const items = await Promise.all(
      sheets.map(async ({ likes, _count, data, ...s }) => ({
        ...(await withImageUrl(s)),
        likeCount: _count.likes,
        likedByMe: likes.length > 0,
      })),
    )
    return reply.send({ sheets: items, total, page: Number(page), limit: Number(limit) })
  })

  // POST /drill-sheets — editor access required (trial or paid)
  app.post('/', { preHandler: requireEditorAccess }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const input = CreateSheetSchema.parse(request.body)
    const sheet = await db.drillSheet.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        // Sheets are public by default; the owner can switch to private.
        published: true,
        publishedAt: new Date(),
        ...(input.data !== undefined && { data: input.data as Prisma.InputJsonValue }),
      },
    })
    return reply.status(201).send(sheet)
  })

  // PATCH /drill-sheets/:id — editor access required
  app.patch('/:id', { preHandler: requireEditorAccess }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const input = UpdateSheetSchema.parse(request.body)
    const existing = await db.drillSheet.findFirst({ where: { id: Number(id), userId } })
    if (!existing) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Sheet not found' })
    const sheet = await db.drillSheet.update({
      where: { id: existing.id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.data !== undefined && { data: input.data as Prisma.InputJsonValue }),
      },
    })
    return reply.send(sheet)
  })

  // POST /drill-sheets/:id/image — the rendered sheet preview
  app.post('/:id/image', { preHandler: requireEditorAccess }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const sheet = await db.drillSheet.findFirst({ where: { id: Number(id), userId } })
    if (!sheet) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Sheet not found' })

    const file = await readUpload(request, { maxBytes: IMAGE_MAX, allowedTypes: IMAGE_TYPES })
    if (sheet.imageKey) await deleteFromS3(sheet.imageKey).catch(() => {/* best-effort */})
    const ext = file.mimetype === 'image/webp' ? 'webp' : file.mimetype === 'image/png' ? 'png' : 'jpg'
    const key = `sheets/${userId}/${sheet.id}/sheet-${Date.now()}.${ext}`
    await uploadToS3(key, file.buffer, file.mimetype)
    await db.drillSheet.update({ where: { id: sheet.id }, data: { imageKey: key } })
    return reply.send({ imageUrl: await presignUrl(key) })
  })

  // PATCH /drill-sheets/:id/publish { published }
  app.patch('/:id/publish', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const { published } = z.object({ published: z.boolean() }).parse(request.body)
    const sheet = await db.drillSheet.findFirst({ where: { id: Number(id), userId } })
    if (!sheet) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Sheet not found' })
    const updated = await db.drillSheet.update({
      where: { id: sheet.id },
      data: { published, publishedAt: published ? new Date() : null },
    })
    return reply.send(await withImageUrl(updated))
  })

  // POST /drill-sheets/:id/like — idempotent
  app.post('/:id/like', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const sheet = await db.drillSheet.findFirst({ where: { id: Number(id), published: true } })
    if (!sheet) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Sheet not found' })
    await db.drillSheetLike.upsert({
      where: { sheetId_userId: { sheetId: sheet.id, userId } },
      update: {},
      create: { sheetId: sheet.id, userId },
    })
    const likeCount = await db.drillSheetLike.count({ where: { sheetId: sheet.id } })
    return reply.send({ liked: true, likeCount })
  })

  // DELETE /drill-sheets/:id/like
  app.delete('/:id/like', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    await db.drillSheetLike.deleteMany({ where: { sheetId: Number(id), userId } })
    const likeCount = await db.drillSheetLike.count({ where: { sheetId: Number(id) } })
    return reply.send({ liked: false, likeCount })
  })

  // DELETE /drill-sheets/:id
  app.delete('/:id', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const sheet = await db.drillSheet.findFirst({ where: { id: Number(id), userId } })
    if (!sheet) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Sheet not found' })
    if (sheet.imageKey) await deleteFromS3(sheet.imageKey).catch(() => {/* best-effort */})
    await db.drillSheet.delete({ where: { id: sheet.id } })
    return reply.status(204).send()
  })
}
