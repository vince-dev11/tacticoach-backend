import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireEditorAccess } from '../../middleware/entitlement-guard.js'
import { db } from '../../config/database.js'
import { uploadToS3, deleteFromS3, presignUrl } from '../../config/s3.js'
import { readUpload } from '../../lib/multipart.js'

const CreateBoardSchema = z.object({
  title: z.string().min(1).max(255).default('Untitled board'),
  pitchKey: z.string().max(50).optional().nullable(),
  state: z.unknown().optional(),
})

const UpdateBoardSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  pitchKey: z.string().max(50).optional().nullable(),
  state: z.unknown().optional(),
})

// Thumbnails are small optimized stills (WebP preferred); videos are the
// compressed 720p preview rendered on publish — the 4K export stays local.
const THUMB_TYPES = ['image/webp', 'image/png', 'image/jpeg']
const THUMB_MAX = 500 * 1024 // 500 KB
const VIDEO_TYPES = ['video/mp4', 'video/webm']
const VIDEO_MAX = 60 * 1024 * 1024 // 60 MB

const BOARD_CARD_SELECT = {
  id: true,
  title: true,
  pitchKey: true,
  thumbnailKey: true,
  videoKey: true,
  published: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

/** Attach short-lived presigned media URLs to a board row. */
async function withMediaUrls<T extends { thumbnailKey?: string | null; videoKey?: string | null }>(
  board: T,
): Promise<T & { thumbnailUrl: string | null; videoUrl: string | null }> {
  const [thumbnailUrl, videoUrl] = await Promise.all([
    board.thumbnailKey ? presignUrl(board.thumbnailKey) : Promise.resolve(null),
    board.videoKey ? presignUrl(board.videoKey) : Promise.resolve(null),
  ])
  return { ...board, thumbnailUrl, videoUrl }
}

export async function canvasRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard)

  // GET /canvas/boards — the current user's boards
  app.get('/boards', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { page = '1', limit = '20' } = request.query as Record<string, string>
    const skip = (Number(page) - 1) * Number(limit)
    const [boards, total] = await Promise.all([
      db.canvasBoard.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: Number(limit),
        select: { ...BOARD_CARD_SELECT, _count: { select: { likes: true } } },
      }),
      db.canvasBoard.count({ where: { userId } }),
    ])
    return reply.send({
      boards: await Promise.all(boards.map(withMediaUrls)),
      total,
      page: Number(page),
      limit: Number(limit),
    })
  })

  // GET /canvas/library — published boards from all users, newest first,
  // with like counts and whether the current user liked each one.
  app.get('/library', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { page = '1', limit = '20' } = request.query as Record<string, string>
    const skip = (Number(page) - 1) * Number(limit)
    const [boards, total] = await Promise.all([
      db.canvasBoard.findMany({
        where: { published: true },
        orderBy: { publishedAt: 'desc' },
        skip,
        take: Number(limit),
        select: {
          ...BOARD_CARD_SELECT,
          user: { select: { id: true, name: true, surname: true, clubName: true } },
          _count: { select: { likes: true } },
          likes: { where: { userId }, select: { id: true } },
        },
      }),
      db.canvasBoard.count({ where: { published: true } }),
    ])
    const items = await Promise.all(
      boards.map(async (b) => {
        const { likes, _count, ...rest } = b
        return {
          ...(await withMediaUrls(rest)),
          likeCount: _count.likes,
          likedByMe: likes.length > 0,
        }
      }),
    )
    return reply.send({ boards: items, total, page: Number(page), limit: Number(limit) })
  })

  // POST /canvas/boards — editor access required (trial or paid)
  app.post('/boards', { preHandler: requireEditorAccess }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const input = CreateBoardSchema.parse(request.body)
    const board = await db.canvasBoard.create({
      data: {
        userId,
        title: input.title,
        pitchKey: input.pitchKey ?? null,
        // Boards are public by default; the owner can switch to private.
        published: true,
        publishedAt: new Date(),
        ...(input.state !== undefined && { state: input.state as Prisma.InputJsonValue }),
      },
    })
    return reply.status(201).send(board)
  })

  // GET /canvas/boards/:id — own boards, or any published board
  app.get('/boards/:id', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const board = await db.canvasBoard.findFirst({
      where: { id: Number(id), OR: [{ userId }, { published: true }] },
    })
    if (!board) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Board not found' })
    return reply.send(await withMediaUrls(board))
  })

  // PATCH /canvas/boards/:id — editor access required
  app.patch('/boards/:id', { preHandler: requireEditorAccess }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const input = UpdateBoardSchema.parse(request.body)
    const existing = await db.canvasBoard.findFirst({ where: { id: Number(id), userId } })
    if (!existing) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Board not found' })
    const updateData: Prisma.CanvasBoardUpdateInput = {}
    if (input.title !== undefined) updateData.title = input.title
    if (input.pitchKey !== undefined) updateData.pitchKey = input.pitchKey
    if (input.state !== undefined) updateData.state = input.state as Prisma.InputJsonValue
    const board = await db.canvasBoard.update({ where: { id: Number(id) }, data: updateData })
    return reply.send(board)
  })

  // DELETE /canvas/boards/:id — also removes S3 media
  app.delete('/boards/:id', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const existing = await db.canvasBoard.findFirst({ where: { id: Number(id), userId } })
    if (!existing) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Board not found' })
    await Promise.all(
      [existing.thumbnailKey, existing.videoKey]
        .filter((k): k is string => !!k)
        .map((k) => deleteFromS3(k).catch(() => {/* best-effort */})),
    )
    await db.canvasBoard.delete({ where: { id: Number(id) } })
    return reply.status(204).send()
  })

  // ---- Media -------------------------------------------------------------------

  // POST /canvas/boards/:id/thumbnail — small WebP/PNG still, replaced on save
  app.post('/boards/:id/thumbnail', { preHandler: requireEditorAccess }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const board = await db.canvasBoard.findFirst({ where: { id: Number(id), userId } })
    if (!board) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Board not found' })

    const file = await readUpload(request, { maxBytes: THUMB_MAX, allowedTypes: THUMB_TYPES })
    if (board.thumbnailKey) await deleteFromS3(board.thumbnailKey).catch(() => {/* best-effort */})
    const ext = file.mimetype === 'image/webp' ? 'webp' : file.mimetype === 'image/png' ? 'png' : 'jpg'
    const key = `boards/${userId}/${board.id}/thumb-${Date.now()}.${ext}`
    await uploadToS3(key, file.buffer, file.mimetype)
    await db.canvasBoard.update({ where: { id: board.id }, data: { thumbnailKey: key } })
    return reply.send({ thumbnailUrl: await presignUrl(key) })
  })

  // POST /canvas/boards/:id/video — compressed preview MP4, uploaded on publish
  app.post('/boards/:id/video', { preHandler: requireEditorAccess }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const board = await db.canvasBoard.findFirst({ where: { id: Number(id), userId } })
    if (!board) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Board not found' })

    const file = await readUpload(request, { maxBytes: VIDEO_MAX, allowedTypes: VIDEO_TYPES })
    if (board.videoKey) await deleteFromS3(board.videoKey).catch(() => {/* best-effort */})
    const ext = file.mimetype === 'video/webm' ? 'webm' : 'mp4'
    const key = `boards/${userId}/${board.id}/video-${Date.now()}.${ext}`
    await uploadToS3(key, file.buffer, file.mimetype)
    await db.canvasBoard.update({ where: { id: board.id }, data: { videoKey: key } })
    return reply.send({ videoUrl: await presignUrl(key) })
  })

  // ---- Publish + likes -----------------------------------------------------------

  // PATCH /canvas/boards/:id/publish  { published: boolean }
  app.patch('/boards/:id/publish', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const { published } = z.object({ published: z.boolean() }).parse(request.body)
    const board = await db.canvasBoard.findFirst({ where: { id: Number(id), userId } })
    if (!board) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Board not found' })
    const updated = await db.canvasBoard.update({
      where: { id: board.id },
      data: { published, publishedAt: published ? new Date() : null },
    })
    return reply.send(await withMediaUrls(updated))
  })

  // POST /canvas/boards/:id/like — idempotent
  app.post('/boards/:id/like', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    const board = await db.canvasBoard.findFirst({ where: { id: Number(id), published: true } })
    if (!board) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Board not found' })
    await db.boardLike.upsert({
      where: { boardId_userId: { boardId: board.id, userId } },
      update: {},
      create: { boardId: board.id, userId },
    })
    const likeCount = await db.boardLike.count({ where: { boardId: board.id } })
    return reply.send({ liked: true, likeCount })
  })

  // DELETE /canvas/boards/:id/like
  app.delete('/boards/:id/like', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { id } = request.params as { id: string }
    await db.boardLike.deleteMany({ where: { boardId: Number(id), userId } })
    const likeCount = await db.boardLike.count({ where: { boardId: Number(id) } })
    return reply.send({ liked: false, likeCount })
  })
}
