// Session Builder — full training sessions composed of ordered blocks.
//
// A block references a library item (board / drill sheet) by id or is plain
// text ("water break", a coaching point). Referencing rather than copying
// means fixing a drill once updates every session that uses it; the client
// resolves refs against the library when rendering/exporting.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireEditorAccess } from '../../middleware/entitlement-guard.js'
import { assertQuota } from '../../lib/plan-quota.js'
import { db } from '../../config/database.js'
import { SESSION_TYPES, MIN_PARTS, MAX_PARTS, RPE_MIN, RPE_MAX } from '../../lib/planner.js'
import { latinOnly } from '../../lib/latin-only.js'

// Lenient on purpose: a half-finished plan must still SAVE. A cleared block
// title or a 0-minute placeholder block is the coach's draft, not an error —
// the earlier strict schema (title min 1, minutes min 1) rejected the whole
// save for one blank field, and the client only ever showed "Save failed".
/**
 * A pitch drawn inside the session (the stacked-pitch builder), in the same
 * wire shape the tactics board saves. Stored as-is in the block JSON; only its
 * shape and size are checked here, the same way the drill sheet stores its
 * drawing. 150 KB is several times a crowded animated board.
 */
const BLOCK_BOARD_MAX_BYTES = 150_000
const SESSION_BODY_LIMIT = 4 * 1024 * 1024
const BlockBoardSchema = z
  .object({ canvas: z.object({ objects: z.array(z.unknown()) }).passthrough(), frames: z.array(z.unknown()) })
  .passthrough()
  .refine((b) => JSON.stringify(b).length <= BLOCK_BOARD_MAX_BYTES, { message: 'Drawing is too large' })

const BlockSchema = z.object({
  /**
   * `drill` is an exercise drawn in the session itself (its pitch is `board`).
   * `board` / `sheet` reference the library; `text` is a note ("water break").
   */
  kind: z.enum(['board', 'sheet', 'text', 'drill']),
  /** Library id for board/sheet blocks; absent for text blocks. */
  refId: z.number().int().positive().optional().nullable(),
  title: latinOnly(z.string().max(255)).transform((t) => t.trim() || 'Untitled block'),
  minutes: z.coerce.number().min(0).max(300).transform((m) => Math.round(m)),
  /**
   * Free-text note. Kept for every block saved before the three structured
   * fields below existed; the client shows it as Organisation and writes the
   * new fields from then on. Not removed — deleting it would silently drop
   * work a coach typed.
   */
  note: z.string().max(2000).optional().nullable(),
  /** What the exercise looks like on the grass: pitch size, numbers, balls. */
  organisation: z.string().max(2000).optional().nullable(),
  /** The conditions — touches, scoring, progressions. */
  rules: z.string().max(2000).optional().nullable(),
  /** One coaching point per line. A list, because that is how it prints. */
  coachingPoints: z.string().max(2000).optional().nullable(),
  /**
   * Which part of the session this block sits in — an index into `parts`.
   * Optional because every block saved before the planner redesign has none;
   * those fall into the main part when the session is opened.
   */
  part: z.coerce.number().int().min(0).max(MAX_PARTS - 1).optional().nullable(),
  /**
   * The drawn mark a text block shows. Stored as the client's icon id and
   * validated only for shape, not against a list: the icon set lives in the
   * frontend and grows there, and an id this server has never heard of falls
   * back to the generic mark on render rather than failing a save.
   */
  icon: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).optional().nullable(),
  /** The exercise's own pitch — drawn here, or a library board edited for this session. */
  board: BlockBoardSchema.optional().nullable(),
  /** The area as a coach says it: "20 × 20 m", "half pitch". Printed under the pitch. */
  area: z.string().max(40).optional().nullable(),
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
  title: latinOnly(z.string().max(255)).transform((t) => t.trim() || 'Untitled session'),
  sessionDate: z.coerce.date().optional().nullable(),
  ageGroup: z.string().max(16).optional().nullable(),
  /// Which of the coach's teams this session is for. Null = their default
  /// squad, which is what every session saved before squads existed uses.
  squadId: z.number().int().positive().optional().nullable(),
  targetMinutes: z.coerce.number().min(1).max(600).transform((m) => Math.round(m)).optional().nullable(),
  blocks: z.array(BlockSchema).max(40).default([]),
  brand: BrandSchema.default({}),

  // ---- Planner fields. All optional: a standalone session sets none of them.
  planWeekId: z.number().int().positive().optional().nullable(),
  sessionType: z.enum(SESSION_TYPES).optional(),
  /** 1–10. Load is derived from this and targetMinutes; it is never sent. */
  intensityRpe: z.coerce.number().int().min(RPE_MIN).max(RPE_MAX).optional().nullable(),
  /** "18:00" — a time of day, not an instant. */
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
    .optional()
    .nullable(),
  isMatch: z.boolean().optional(),
  opponent: z.string().max(120).optional().nullable(),
  venue: z.string().max(120).optional().nullable(),
  // ---- Match details. Only meaningful when isMatch; ignored otherwise.
  homeAway: z.enum(['home', 'away']).optional().nullable(),
  competition: z.string().max(80).optional().nullable(),
  goalsFor: z.coerce.number().int().min(0).max(99).optional().nullable(),
  goalsAgainst: z.coerce.number().int().min(0).max(99).optional().nullable(),
  matchNote: z.string().max(1000).optional().nullable(),
  /** Part names in order. Three to five, or empty for the defaults. */
  parts: z
    .array(z.string().max(60).transform((n) => n.trim()))
    .max(MAX_PARTS)
    .refine((p) => p.length === 0 || p.length >= MIN_PARTS, {
      message: `A session has ${MIN_PARTS} to ${MAX_PARTS} parts`,
    })
    .optional(),
})

// No defaults on update. `.partial()` keeps the create schema's defaults, so a
// PATCH that sent only `blocks` (the "Add to session" dialog) also wrote
// `brand: {}` — wiping the session's colour and logo setting every time a
// drill was added — and a PATCH with only a result would have emptied the
// session's blocks. A field that is not sent must not be touched.
const UpdateSessionSchema = CreateSessionSchema.extend({
  blocks: z.array(BlockSchema).max(40).optional(),
  brand: BrandSchema.optional(),
}).partial()

type MatchInput = Partial<Pick<z.infer<typeof CreateSessionSchema>, 'homeAway' | 'competition' | 'goalsFor' | 'goalsAgainst' | 'matchNote'>>

/**
 * The match columns (migration 37), for create and update. Only keys that were
 * sent are written, so a PATCH that edits a session's title leaves the score
 * alone.
 *
 * ---- TEMPORARY typing: the generated Prisma client learns these columns when
 * `prisma generate` runs against migration 37 (the deploy script does); until
 * then the object is passed through untyped. Runtime is unaffected.
 */
function matchData(input: MatchInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of ['homeAway', 'competition', 'goalsFor', 'goalsAgainst', 'matchNote'] as const) {
    if (input[k] !== undefined) out[k] = typeof input[k] === 'string' ? (input[k] as string).trim() || null : input[k]
  }
  return out
}

/**
 * Resolve a plan-week id the client sent, but only if this coach owns the plan
 * it belongs to. Returns null for anything else.
 *
 * Without this check the week id is an unvalidated foreign key straight from
 * the request body: a coach could file his own session into another coach's
 * season plan, and it would then appear on that coach's week screen.
 */
async function ownedWeekId(userId: number, weekId: number | null | undefined): Promise<number | null> {
  if (!weekId) return null
  const week = await db.planWeek.findFirst({
    where: { id: weekId, plan: { userId } },
    select: { id: true },
  })
  return week?.id ?? null
}

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
        squadId: true,
        targetMinutes: true,
        blocks: true,
        updatedAt: true,
        planWeekId: true,
        sessionType: true,
        intensityRpe: true,
        startTime: true,
        isMatch: true,
        opponent: true,
        ...({ homeAway: true, goalsFor: true, goalsAgainst: true } as object),
        parts: true,
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
  // Drawn pitches ride inside the blocks, so a session can outgrow the 1 MB
  // default. 4 MB is a dozen crowded drawings with room to spare.
  app.post('/', { preHandler: requireEditorAccess, bodyLimit: SESSION_BODY_LIMIT }, async (request, reply) => {
    const userId = (request.user as any).sub as number
    const input = CreateSessionSchema.parse(request.body)
    // A fixture is not training content: a free coach (one session) must
    // still be able to enter the season's matches. See plan-quota COUNTERS.
    if (!input.isMatch) await assertQuota(userId, 'sessions')
    const session = await db.trainingSession.create({
      data: {
        userId,
        title: input.title,
        sessionDate: input.sessionDate ?? null,
        ageGroup: input.ageGroup ?? null,
        squadId: input.squadId ?? null,
        targetMinutes: input.targetMinutes ?? null,
        blocks: input.blocks as Prisma.InputJsonValue,
        brand: input.brand,
        // A week id from the client is only honoured if the coach owns that
        // week — otherwise anyone could file sessions into someone else's plan.
        planWeekId: await ownedWeekId(userId, input.planWeekId),
        ...(input.sessionType !== undefined && { sessionType: input.sessionType }),
        intensityRpe: input.intensityRpe ?? null,
        startTime: input.startTime ?? null,
        isMatch: input.isMatch ?? false,
        opponent: input.opponent ?? null,
        venue: input.venue ?? null,
        parts: input.parts ?? [],
        ...(matchData(input) as object),
      },
    })
    return reply.status(201).send(session)
  })

  // PATCH /sessions/:id — update (owner only)
  app.patch('/:id', { preHandler: requireEditorAccess, bodyLimit: SESSION_BODY_LIMIT }, async (request, reply) => {
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
        ...(input.squadId !== undefined && { squadId: input.squadId }),
        ...(input.targetMinutes !== undefined && { targetMinutes: input.targetMinutes }),
        ...(input.blocks !== undefined && { blocks: input.blocks as Prisma.InputJsonValue }),
        ...(input.brand !== undefined && { brand: input.brand }),
        ...(input.planWeekId !== undefined && {
          planWeekId: await ownedWeekId(userId, input.planWeekId),
        }),
        ...(input.sessionType !== undefined && { sessionType: input.sessionType }),
        ...(input.intensityRpe !== undefined && { intensityRpe: input.intensityRpe }),
        ...(input.startTime !== undefined && { startTime: input.startTime }),
        ...(input.isMatch !== undefined && { isMatch: input.isMatch }),
        ...(input.opponent !== undefined && { opponent: input.opponent }),
        ...(input.venue !== undefined && { venue: input.venue }),
        ...(input.parts !== undefined && { parts: input.parts }),
        ...(matchData(input) as object),
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
