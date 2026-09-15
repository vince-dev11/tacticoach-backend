// Season planner API.
//
//   GET    /api/plans                 the coach's plans
//   POST   /api/plans                 create a plan and its weeks
//   GET    /api/plans/:id             the season screen
//   PATCH  /api/plans/:id             title / label / week-starts-on
//   DELETE /api/plans/:id
//   POST   /api/plans/:id/weeks       append weeks
//   GET    /api/plans/weeks/:weekId   the week screen
//   PATCH  /api/plans/weeks/:weekId   theme / phase
//   POST   /api/plans/weeks/:weekId/copy-to    { toWeekId }
//   POST   /api/plans/weeks/:weekId/clear
//
// Ownership is checked on every route by scoping the query through the plan's
// userId — never by trusting an id in the path.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireEditorAccess } from '../../middleware/entitlement-guard.js'
import { db } from '../../config/database.js'
import { SEASON_PHASES, type WeekStart } from '../../lib/planner.js'
import {
  getPlan,
  getWeek,
  createPlan,
  addWeeks,
  copyWeek,
  clearWeek,
  listPlans,
  MAX_WEEKS,
} from './plans.service.js'

/** Prisma maps 'pre-season' to the enum member `pre_season`. */
const toPrismaPhase = (phase: string) => phase.replace('-', '_') as 'pre_season' | 'in_season' | 'transition'

const CreatePlanSchema = z.object({
  title: z.string().max(255).transform((t) => t.trim() || 'Season plan'),
  ageGroup: z.string().max(16).optional().nullable(),
  seasonLabel: z.string().max(40).optional().nullable(),
  startDate: z.coerce.date(),
  weekStartsOn: z.coerce.number().int().min(0).max(6).default(1),
  /** The coach chooses how many weeks to plan — his request, section 1. */
  weeks: z.coerce.number().int().min(1).max(MAX_WEEKS).default(42),
})

const UpdatePlanSchema = z.object({
  title: z.string().max(255).optional(),
  ageGroup: z.string().max(16).optional().nullable(),
  seasonLabel: z.string().max(40).optional().nullable(),
  weekStartsOn: z.coerce.number().int().min(0).max(6).optional(),
})

const UpdateWeekSchema = z.object({
  theme: z.string().max(255).optional().nullable(),
  phase: z.enum(SEASON_PHASES).optional(),
})

const notFound = (what: string) => ({
  statusCode: 404,
  error: 'Not Found',
  message: `${what} not found`,
})

export async function plansRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard)

  const uid = (request: { user: unknown }) => (request.user as { sub: number }).sub
  const idOf = (request: { params: unknown }, key = 'id') =>
    Number((request.params as Record<string, string>)[key])

  // ---- Plans ----------------------------------------------------------------

  app.get('/', async (request) => listPlans(uid(request)))

  app.post('/', { preHandler: requireEditorAccess }, async (request, reply) => {
    const input = CreatePlanSchema.parse(request.body)
    const planId = await createPlan({
      userId: uid(request),
      title: input.title,
      ageGroup: input.ageGroup,
      seasonLabel: input.seasonLabel,
      startDate: input.startDate,
      weekStartsOn: input.weekStartsOn as WeekStart,
      weeks: input.weeks,
    })
    return reply.status(201).send(await getPlan(uid(request), planId))
  })

  app.get('/:id', async (request, reply) => {
    const plan = await getPlan(uid(request), idOf(request))
    return plan ? reply.send(plan) : reply.status(404).send(notFound('Plan'))
  })

  app.patch('/:id', { preHandler: requireEditorAccess }, async (request, reply) => {
    const id = idOf(request)
    const owned = await db.seasonPlan.findFirst({ where: { id, userId: uid(request) }, select: { id: true } })
    if (!owned) return reply.status(404).send(notFound('Plan'))

    const input = UpdatePlanSchema.parse(request.body)
    await db.seasonPlan.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title.trim() || 'Season plan' }),
        ...(input.ageGroup !== undefined && { ageGroup: input.ageGroup }),
        ...(input.seasonLabel !== undefined && { seasonLabel: input.seasonLabel }),
        ...(input.weekStartsOn !== undefined && { weekStartsOn: input.weekStartsOn }),
      },
    })
    // Changing the week start moves every week boundary, so the whole plan is
    // re-read rather than patched client-side.
    return reply.send(await getPlan(uid(request), id))
  })

  app.delete('/:id', async (request, reply) => {
    const id = idOf(request)
    const owned = await db.seasonPlan.findFirst({ where: { id, userId: uid(request) }, select: { id: true } })
    if (!owned) return reply.status(404).send(notFound('Plan'))

    // Weeks cascade; sessions do not — their plan_week_id is SET NULL, so the
    // coach's actual work survives and returns to his session library.
    await db.seasonPlan.delete({ where: { id } })
    return reply.send({ message: 'Plan deleted' })
  })

  app.post('/:id/weeks', { preHandler: requireEditorAccess }, async (request, reply) => {
    const id = idOf(request)
    const owned = await db.seasonPlan.findFirst({ where: { id, userId: uid(request) }, select: { id: true } })
    if (!owned) return reply.status(404).send(notFound('Plan'))

    const { count } = z.object({ count: z.coerce.number().int().min(1).max(MAX_WEEKS).default(1) }).parse(
      request.body ?? {},
    )
    await addWeeks(id, count)
    return reply.send(await getPlan(uid(request), id))
  })

  // ---- Weeks ----------------------------------------------------------------

  app.get('/weeks/:weekId', async (request, reply) => {
    const week = await getWeek(uid(request), idOf(request, 'weekId'))
    return week ? reply.send(week) : reply.status(404).send(notFound('Week'))
  })

  app.patch('/weeks/:weekId', { preHandler: requireEditorAccess }, async (request, reply) => {
    const weekId = idOf(request, 'weekId')
    const owned = await db.planWeek.findFirst({
      where: { id: weekId, plan: { userId: uid(request) } },
      select: { id: true },
    })
    if (!owned) return reply.status(404).send(notFound('Week'))

    const input = UpdateWeekSchema.parse(request.body)
    await db.planWeek.update({
      where: { id: weekId },
      data: {
        ...(input.theme !== undefined && { theme: input.theme }),
        ...(input.phase !== undefined && { phase: toPrismaPhase(input.phase) }),
      },
    })
    return reply.send(await getWeek(uid(request), weekId))
  })

  app.post('/weeks/:weekId/copy-to', { preHandler: requireEditorAccess }, async (request, reply) => {
    const { toWeekId } = z.object({ toWeekId: z.coerce.number().int().positive() }).parse(request.body)
    const fromWeekId = idOf(request, 'weekId')
    if (fromWeekId === toWeekId) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Pick a different week to copy into',
      })
    }

    const copied = await copyWeek(uid(request), fromWeekId, toWeekId)
    return reply.send({ copied, week: await getWeek(uid(request), toWeekId) })
  })

  app.post('/weeks/:weekId/clear', { preHandler: requireEditorAccess }, async (request, reply) => {
    const weekId = idOf(request, 'weekId')
    const cleared = await clearWeek(uid(request), weekId)
    return reply.send({ cleared, week: await getWeek(uid(request), weekId) })
  })
}
