import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireEditorAccess } from '../../middleware/entitlement-guard.js'
import { videoQuota, recordVideoExport } from '../../lib/video-quota.js'
import { withQuota } from '../../lib/plan-quota.js'
import { getEntitlements } from '../../lib/entitlements.js'
import { db } from '../../config/database.js'
import { uploadToS3, deleteFromS3, presignUrl } from '../../config/s3.js'
import { readUpload } from '../../lib/multipart.js'
import { latinOnly } from '../../lib/latin-only.js'
import { pageParams } from '../../lib/paging.js'

/** Coach-chosen category tags — an enum so a client bug can't grow junk labels. */
export const BOARD_TAGS = [
  'warm-up', 'rondo', 'possession', 'build-out', 'attacking', 'finishing',
  'transition', 'pressing', 'defending', 'set-piece', 'goalkeeping',
] as const
const TagsSchema = z.array(z.enum(BOARD_TAGS)).max(3)

/** Save-time details (the editor requires them; the API stays lenient so
 *  older clients and partial PATCHes keep working). */
export const BOARD_AGE_GROUPS = ['u7', 'u9', 'u11', 'u13', 'u15', 'u17', 'senior'] as const
export const BOARD_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const
const DetailsSchema = {
  ageGroup: z.enum(BOARD_AGE_GROUPS).optional().nullable(),
  difficulty: z.enum(BOARD_DIFFICULTIES).optional().nullable(),
}

const CreateBoardSchema = z.object({
  title: latinOnly(z.string().min(1).max(255)).default('Untitled board'),
  pitchKey: z.string().max(50).optional().nullable(),
  state: z.unknown().optional(),
  tags: TagsSchema.optional(),
  ...DetailsSchema,
  /** Share to the community library. Off unless the coach ticks it. */
  published: z.boolean().optional(),
})

const UpdateBoardSchema = z.object({
  title: latinOnly(z.string().min(1).max(255)).optional(),
  pitchKey: z.string().max(50).optional().nullable(),
  state: z.unknown().optional(),
  tags: TagsSchema.optional(),
  ...DetailsSchema,
})

/**
 * The coach's context at save time, attached silently. Labels every board
 * with who it was made FOR (age, format, level, shape) — the pairing a future
 * tactics model trains on, and impossible to reconstruct later.
 */
async function contextSnapshotFor(userId: number) {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { coachAgeGroup: true, coachFormat: true, coachLevel: true, coachFormation: true, coachSquadSize: true },
  })
  if (!u) return undefined
  const snap = {
    ageGroup: u.coachAgeGroup, format: u.coachFormat, level: u.coachLevel,
    formation: u.coachFormation, squadSize: u.coachSquadSize,
  }
  // All-null contexts carry no signal — store nothing rather than noise.
  return Object.values(snap).some((v) => v != null) ? snap : undefined
}

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
  hasAnimation: true,
  tags: true,
  ageGroup: true,
  difficulty: true,
  createdAt: true,
  updatedAt: true,
} as const

/**
 * True when a saved board state contains real movement: any frame whose
 * objects carry at least one step. Stamped on the row at save time so library
 * cards can label "Animation" vs "Static board" without loading state JSON.
 */
function stateHasAnimation(state: unknown): boolean {
  const frames = (state as { frames?: unknown })?.frames
  if (!Array.isArray(frames)) return false
  return frames.some((f) => {
    const objects = (f as { objects?: unknown })?.objects
    return Array.isArray(objects) && objects.some((o) => {
      const steps = (o as { steps?: unknown })?.steps
      return Array.isArray(steps) && steps.length > 0
    })
  })
}

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
    const { page, limit, skip } = pageParams(request.query)
    const [boards, total] = await Promise.all([
      db.canvasBoard.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        select: { ...BOARD_CARD_SELECT, _count: { select: { likes: true } } },
      }),
      db.canvasBoard.count({ where: { userId } }),
    ])
    return reply.send({
      boards: await Promise.all(boards.map(withMediaUrls)),
      total,
      page,
      limit,
    })
  })

  // GET /canvas/library — published boards from all users, newest first,
  // with like counts and whether the current user liked each one.
  app.get('/library', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const { page, limit, skip } = pageParams(request.query)
    const [boards, total] = await Promise.all([
      db.canvasBoard.findMany({
        where: { published: true },
        orderBy: { publishedAt: 'desc' },
        skip,
        take: limit,
        select: {
          ...BOARD_CARD_SELECT,
          // coachSlug links the card to the coach's page; the page itself
          // 404s if it isn't live, so no per-row liveness check here. But the
          // page is opt-in: with it switched off the card carries no link and
          // no photo (the photo is part of what the coach chose to show).
          user: { select: { id: true, name: true, surname: true, clubName: true, coachSlug: true, coachPhotoKey: true, coachColor: true, coachPageEnabled: true } },
          _count: { select: { likes: true } },
          likes: { where: { userId }, select: { id: true } },
        },
      }),
      db.canvasBoard.count({ where: { published: true } }),
    ])
    const items = await Promise.all(
      boards.map(async (b) => {
        const { likes, _count, user, ...rest } = b
        const { coachPhotoKey, coachPageEnabled, coachSlug, ...coach } = user
        return {
          ...(await withMediaUrls(rest)),
          user: {
            ...coach,
            coachSlug: coachPageEnabled ? coachSlug : null,
            coachPhotoUrl: coachPageEnabled && coachPhotoKey ? await presignUrl(coachPhotoKey) : null,
          },
          likeCount: _count.likes,
          likedByMe: likes.length > 0,
        }
      }),
    )
    return reply.send({ boards: items, total, page, limit })
  })

  // POST /canvas/boards — editor access required (trial or paid)
  app.post('/boards', { preHandler: requireEditorAccess }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const input = CreateBoardSchema.parse(request.body)
    // Counted before the create (free trial: three, ever — see plan-quota),
    // and handed back if the create fails.
    const board = await withQuota(userId, 'boards', async () => db.canvasBoard.create({
      data: {
        userId,
        title: input.title,
        pitchKey: input.pitchKey ?? null,
        // PRIVATE unless the coach ticked "share to the community" when
        // saving. Boards were public by default until 30 Sep 2026, which put
        // a coach's first board — with their real players' names on it — in
        // the public library without them choosing it.
        published: input.published === true,
        publishedAt: input.published === true ? new Date() : null,
        ...(input.state !== undefined && { state: input.state as Prisma.InputJsonValue }),
        ...(input.tags !== undefined && { tags: input.tags }),
        ...(input.ageGroup !== undefined && { ageGroup: input.ageGroup }),
        ...(input.difficulty !== undefined && { difficulty: input.difficulty }),
        hasAnimation: stateHasAnimation(input.state),
        ...((snap) => (snap !== undefined ? { contextSnapshot: snap } : {}))(await contextSnapshotFor(userId)),
      },
    }))
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
    if (input.state !== undefined) {
      updateData.state = input.state as Prisma.InputJsonValue
      updateData.hasAnimation = stateHasAnimation(input.state)
      // Re-snapshot on content saves so the label follows the latest context.
      const snap = await contextSnapshotFor(userId)
      if (snap !== undefined) updateData.contextSnapshot = snap
    }
    if (input.tags !== undefined) updateData.tags = input.tags
    if (input.ageGroup !== undefined) updateData.ageGroup = input.ageGroup
    if (input.difficulty !== undefined) updateData.difficulty = input.difficulty
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

    // Checked BEFORE the upload is read, not after: refusing a coach's video
    // once the whole file has already crossed the wire wastes their time and
    // our bandwidth to reach the same answer.
    const quota = await videoQuota(userId)
    if (!quota.allowed) {
      return reply.status(402).send({
        statusCode: 402,
        error: 'Payment Required',
        message: `You have used all ${quota.limit} video exports this month. Upgrade to Pro for unlimited HD exports.`,
        quota,
      })
    }

    const file = await readUpload(request, { maxBytes: VIDEO_MAX, allowedTypes: VIDEO_TYPES })
    if (board.videoKey) await deleteFromS3(board.videoKey).catch(() => {/* best-effort */})
    const ext = file.mimetype === 'video/webm' ? 'webm' : 'mp4'
    const key = `boards/${userId}/${board.id}/video-${Date.now()}.${ext}`
    await uploadToS3(key, file.buffer, file.mimetype)
    await db.canvasBoard.update({ where: { id: board.id }, data: { videoKey: key } })
    // Recorded only now, after the upload actually succeeded — a failed upload
    // must not eat one of a coach's ten.
    await recordVideoExport(userId, board.id, (await getEntitlements(userId)).plan?.slug ?? null)
    return reply.send({ videoUrl: await presignUrl(key), quota: await videoQuota(userId) })
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
