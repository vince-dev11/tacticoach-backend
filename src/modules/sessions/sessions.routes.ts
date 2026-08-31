// Session Builder — full training sessions composed of ordered blocks.
//
// A block references a library item (board / drill sheet) by id or is plain
// text ("water break", a coaching point). Referencing rather than copying
// means fixing a drill once updates every session that uses it; the client
// resolves refs against the library when rendering/exporting.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireEditorAccess } from '../../middleware/entitlement-guard.js'
import { db } from '../../config/database.js'

const BlockSchema = z.object({
  kind: z.enum(['board', 'sheet', 'text']),
  /** Library id for board/sheet blocks; absent for text blocks. */
  refId: z.number().int().positive().optional(),
  title: z.string().min(1).max(255),
  minutes: z.number().int().min(1).max(180),
  note: z.string().max(1000).optional(),
})

const BrandSchema = z.object({
  /** Accent colour for the exported PDF (hex). */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** Show the coach's club logo (from their profile) on the cover. */
  showClubLogo: z.boolean().optional(),
})

const CreateSessionSchema = z.object({
  title: z.string().min(1).max(255),
  sessionDate: z.coerce.date().optional().nullable(),
  ageGroup: z.string().max(16).optional().nullable(),
  targetMinutes: z.number().int().min(10).max(300).optional().nullable(),
  blocks: z.array(BlockSchema).max(40).default([]),
  brand: BrandSchema.default({}),
})

const UpdateSessionSchema = CreateSessionSchema.partial()

export async function sessionsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard)

  // GET /sessions — my sessions, most recently edited first
  app.get('/', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const sessions = await db.trainingSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        sessionDate: true,
        ageGroup: true,
        targetMinutes: true,
        blocks: true,
        updatedAt: true,
      },
    })
    return reply.send(sessions)
  })

  // GET /sessions/:id — full session (owner only)
  app.get('/:id', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const id = Number((request.params as { id: string }).id)
    const session = await db.trainingSession.findFirst({ where: { id, userId } })
    if (!session) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Session not found' })
    }
    return reply.send(session)
  })

  // POST /sessions — create (needs editor access, like boards and sheets)
  app.post('/', { preHandler: requireEditorAccess }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const input = CreateSessionSchema.parse(request.body)
    const session = await db.trainingSession.create({
      data: {
        userId,
        title: input.title,
        sessionDate: input.sessionDate ?? null,
        ageGroup: input.ageGroup ?? null,
        targetMinutes: input.targetMinutes ?? null,
        blocks: input.blocks,
        brand: input.brand,
      },
    })
    return reply.status(201).send(session)
  })

  // PATCH /sessions/:id — update (owner only)
  app.patch('/:id', { preHandler: requireEditorAccess }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const id = Number((request.params as { id: string }).id)
    const existing = await db.trainingSession.findFirst({ where: { id, userId }, select: { id: true } })
    if (!existing) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Session not found' })
    }
    const input = UpdateSessionSchema.parse(request.body)
    const session = await db.trainingSession.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.sessionDate !== undefined && { sessionDate: input.sessionDate }),
        ...(input.ageGroup !== undefined && { ageGroup: input.ageGroup }),
        ...(input.targetMinutes !== undefined && { targetMinutes: input.targetMinutes }),
        ...(input.blocks !== undefined && { blocks: input.blocks }),
        ...(input.brand !== undefined && { brand: input.brand }),
      },
    })
    return reply.send(session)
  })

  // DELETE /sessions/:id — owner only
  app.delete('/:id', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const id = Number((request.params as { id: string }).id)
    const existing = await db.trainingSession.findFirst({ where: { id, userId }, select: { id: true } })
    if (!existing) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Session not found' })
    }
    await db.trainingSession.delete({ where: { id } })
    return reply.send({ message: 'Session deleted' })
  })
}
