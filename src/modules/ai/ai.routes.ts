// AI tactical generator — POST /api/canvas/ai-layout and /ai-animation.
//
// Wire contract matches the editor client (frontend src/editor/api.ts):
//   ai-layout    → { success, prompt, source, summary, layout: Item[] }
//   ai-animation → { success, prompt, source, summary, scene: { objects }, frames: [{ moves }] }
//
// Both routes require login + editor entitlement (trial/subscription/club
// seat) and carry a per-user rate limit — each call costs a Gemini request.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireEditorAccess } from '../../middleware/entitlement-guard.js'
import { geminiConfigured, generateTacticsJson, GeminiError } from '../../config/gemini.js'
import {
  getCreditState,
  recordCreditSpend,
  isFreeRetry,
  recordFreeRetry,
  creditsForWire,
  remainingForWire,
} from '../../lib/credits.js'
import { layoutSystemPrompt, animationSystemPrompt, planSystemPrompt, reelCopySystemPrompt, userPrompt } from './ai.prompts.js'
import { compilePattern } from './ai.dsl.js'
import { patternById } from './ai.patterns.js'
import {
  RequestSchema,
  ReelCopyRequestSchema,
  ReelCopyOutputSchema,
  LayoutOutputSchema,
  AnimationOutputSchema,
  layoutResponseSchema,
  animationResponseSchema,
  reelCopyResponseSchema,
  sanitiseObjects,
  sanitiseFrames,
  PlanSchema,
  planResponseSchema,
} from './ai.schema.js'
import {
  resolveContext, describeContext, type CoachContext, type LooseContext,
} from './ai.context.js'

import {
  validateLayout, validateAnimation, validateReelCopy, validateBrief,
  validateSquadSize, validateAgeAppropriate,
  validatePrinciples, tacticalScore, principleIssues,
} from './ai.validate.js'
import { conceptFor, type PrincipleId } from './ai.concepts.js'
import { db } from '../../config/database.js'
import { requireOwner } from '../../middleware/owner-guard.js'
import {
  CorrectionRequestSchema, correctionAggregates, isWorthKeeping,
} from './ai.corrections.js'

/**
 * Loose handle for the ai_corrections model, until `prisma generate` runs on a
 * machine with network access and the client learns it. Same convention as the
 * freeRetry cast in credits.ts.
 */
interface PrismaWithCorrections {
  aiCorrection: {
    create(args: unknown): Promise<unknown>
    groupBy(args: unknown): Promise<unknown>
  }
}

/** Shape of the coach-context columns, until `prisma generate` knows them. */
interface LooseContextRow {
  coachAgeGroup?: string | null
  coachFormat?: string | null
  coachLevel?: string | null
  coachFormation?: string | null
  coachSquadSize?: number | null
}

const RATE_LIMIT = {
  max: 20,
  timeWindow: '10 minutes',
  // Per-user, not per-IP: authenticated routes, and coaches often share club WiFi.
  keyGenerator: (req: FastifyRequest) =>
    String((req.user as { sub?: number } | undefined)?.sub ?? req.ip),
} as const

/**
 * Call Gemini, retrying transient failures WITH BACKOFF. Free-tier capacity
 * 503s ("high demand") and 429s clear within seconds — an immediate retry
 * just hits the same overloaded moment, so we wait before each attempt.
 */
const RETRY_DELAYS_MS = process.env.NODE_ENV === 'test' ? [5, 10] : [1500, 4000]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function generateWithRetry(
  system: string,
  user: string,
  options?: Parameters<typeof generateTacticsJson>[2],
): Promise<unknown> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1])
    try {
      return await generateTacticsJson(system, user, options)
    } catch (err) {
      lastErr = err
      if (!(err instanceof GeminiError) || !err.retryable) throw err
    }
  }
  throw lastErr
}

/**
 * Generate → parse → football-validate; when validation finds issues, run ONE
 * corrective attempt with the issues quoted back to the model. Returns null
 * when no attempt produced structurally usable output (route replies 502).
 * Soft issues that survive the correction are accepted and logged — the
 * editor is the coach's final control, a slightly imperfect board beats a 502.
 */
async function withCorrection<T>(
  system: string,
  user: string,
  responseSchema: unknown,
  build: (raw: unknown) => { value: T; issues: string[] } | null,
  log: { warn: (obj: unknown, msg?: string) => void },
): Promise<T | null> {
  const first = build(await generateWithRetry(system, user, { responseSchema, temperature: 0.5 }))
  if (first && first.issues.length === 0) return first.value

  const feedback = first ? first.issues : ['the JSON did not match the required structure']
  log.warn({ feedback }, 'AI output failed validation — corrective retry')
  const corrective = `${user}

Your previous attempt had these problems:
${feedback.map((f) => `- ${f}`).join('\n')}
Return a corrected JSON document only.`
  try {
    const second = build(await generateWithRetry(system, corrective, { responseSchema, temperature: 0.4 }))
    if (second) {
      if (second.issues.length > 0) log.warn({ issues: second.issues }, 'AI output still imperfect after correction — accepting')
      return second.value
    }
  } catch {
    /* corrective attempt failed — fall back to the first if it was usable */
  }
  return first ? first.value : null
}

export async function aiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard)
  app.addHook('preHandler', requireEditorAccess)

  const guardConfigured = (reply: { status: (c: number) => { send: (b: unknown) => unknown } }) =>
    reply.status(503).send({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'AI generation is not configured on this server',
    })

  /**
   * Bill a generation that has already succeeded — without ever letting the
   * billing destroy it.
   *
   * The gate above runs BEFORE the model is called and fails closed: if we can't
   * read someone's balance we must not spend money on their behalf. This runs
   * AFTER, and fails open, because by now the coach has waited ten seconds and
   * the animation exists. Throwing it away over a bookkeeping error would be the
   * worst of both worlds — no result, and no charge either. We log loudly and
   * hand over the work.
   */
  const settle = async (
    userId: number,
    kind: 'layout' | 'animation',
    prompt: string,
  ): Promise<{ free: boolean; creditsRemaining: number | null }> => {
    try {
      const state = await getCreditState(userId)
      // An account with no limit is never charged, so "was this retry free?" is
      // a question with no meaning — and no reason to go looking for an answer.
      if (!state.unlimited && (await isFreeRetry(userId, kind, prompt))) {
        await recordFreeRetry(userId, kind, prompt)
        return { free: true, creditsRemaining: remainingForWire((await getCreditState(userId)).remaining) }
      }
      return {
        free: false,
        creditsRemaining: remainingForWire(await recordCreditSpend(userId, kind, prompt)),
      }
    } catch (err) {
      app.log.error({ err, userId, kind }, 'credit accounting failed after a successful generation')
      // null = "we don't know your balance right now", which the editor already
      // renders as no number rather than as zero.
      return { free: false, creditsRemaining: null }
    }
  }

  /**
   * Who this session is for: the per-request override if the coach set one in
   * the AI panel, otherwise their saved profile, otherwise senior 11-a-side.
   *
   * A failure to read the profile must not cost the coach a generation — this
   * is context that improves the answer, not permission to produce one — so a
   * database hiccup degrades to the default rather than throwing.
   */
  const coachContext = async (
    userId: number,
    override: LooseContext | undefined,
    log: FastifyRequest['log'],
  ): Promise<CoachContext> => {
    try {
      // The generated Prisma client only learns these columns after the
      // migration + `prisma generate` run on a machine with network access, so
      // the narrow cast keeps this compiling before and after that step. The
      // catch below means a client that predates them degrades to defaults
      // rather than failing the generation.
      const profile = (await db.user.findUnique({
        where: { id: userId },
        select: {
          coachAgeGroup: true, coachFormat: true, coachLevel: true,
          coachFormation: true, coachSquadSize: true,
        } as never,
      })) as LooseContextRow | null
      return resolveContext(override, {
        age: profile?.coachAgeGroup,
        format: profile?.coachFormat,
        level: profile?.coachLevel,
        formation: profile?.coachFormation,
        squad: profile?.coachSquadSize,
      })
    } catch (err) {
      log.warn({ err, userId }, 'could not read coach profile — using defaults')
      return resolveContext(override, undefined)
    }
  }

  /** Gate on AI credits. Returns the state when spendable, or replies 402. */
  const requireCredit = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as { sub: number }).sub
    const state = await getCreditState(userId)
    if (state.remaining <= 0) {
      await reply.status(402).send({
        statusCode: 402,
        error: 'Payment Required',
        message: state.monthly
          ? 'You have used all your AI credits for this month. Buy a top-up pack or upgrade your plan.'
          : 'Your trial AI credits are used up. Choose a plan to keep generating.',
        credits: creditsForWire(state),
      })
      return null
    }
    return state
  }

  // POST /ai-layout — static board setup from natural language
  app.post('/ai-layout', { config: { rateLimit: RATE_LIMIT } }, async (request, reply) => {
    if (!geminiConfigured()) return guardConfigured(reply)
    if ((await requireCredit(request, reply)) === null) return
    const { prompt, board, context } = RequestSchema.parse(request.body)
    const ctx = await coachContext((request.user as { sub: number }).sub, context, request.log)

    let result: { summary: string; layout: ReturnType<typeof sanitiseObjects> } | null
    try {
      result = await withCorrection(
        layoutSystemPrompt(prompt, board, ctx),
        userPrompt(prompt),
        layoutResponseSchema,
        (raw) => {
          const parsed = LayoutOutputSchema.safeParse(raw)
          if (!parsed.success) return null
          const layout = sanitiseObjects(parsed.data.objects, board)
          if (layout.length === 0) return null
          return {
            value: { summary: parsed.data.summary, layout },
            issues: [
              ...validateLayout(layout, prompt),
              ...validateSquadSize(layout, ctx),
              ...validateAgeAppropriate(parsed.data.brief?.concept, ctx),
              ...validateBrief(parsed.data.brief, layout, [], board),
            ],
          }
        },
        request.log,
      )
    } catch (err) {
      request.log.error({ err }, 'AI layout generation failed')
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI generation failed. Please try again.' })
    }
    if (!result) {
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI produced an unusable layout. Please try again.' })
    }

    const uid = (request.user as { sub: number }).sub
    const { free, creditsRemaining } = await settle(uid, 'layout', prompt)
    return reply.send({
      success: true,
      prompt,
      source: 'gemini',
      freeRetry: free,
      summary: result.summary,
      layout: result.layout,
      creditsRemaining,
    })
  })

  // POST /ai-animation — initial scene + movement frames
  app.post('/ai-animation', { config: { rateLimit: RATE_LIMIT } }, async (request, reply) => {
    if (!geminiConfigured()) return guardConfigured(reply)
    if ((await requireCredit(request, reply)) === null) return
    const { prompt, board, context } = RequestSchema.parse(request.body)
    const ctx = await coachContext((request.user as { sub: number }).sub, context, request.log)

    interface AnimResult {
      summary: string
      objects: ReturnType<typeof sanitiseObjects>
      frames: ReturnType<typeof sanitiseFrames>
    }
    let result: AnimResult | null = null
    let source = 'gemini'
    // Wall-clock for the whole generation. Latency is a quality signal in its
    // own right: a coach who waits twelve seconds may regenerate for reasons
    // that have nothing to do with the football, which would poison any
    // preference data we later collect. It also tells us what the compiler path
    // is actually buying us over the model path.
    const startedAt = Date.now()

    // Principles the concept must demonstrate. The brief may name its own; the
    // concept card is the authority when the request matches a known concept.
    const card = conceptFor(prompt)
    const requiredPrinciples: PrincipleId[] = card?.principles ?? []

    // ---- Path 1: Football DSL. The model picks a PATTERN (symbolic plan);
    // a deterministic compiler owns all geometry — teleports, abandoned balls
    // and statue teams are impossible by construction. Any failure here falls
    // through silently to direct generation.
    try {
      const rawPlan = await generateWithRetry(planSystemPrompt(), userPrompt(prompt), {
        responseSchema: planResponseSchema,
        temperature: 0.2,
      })
      const plan = PlanSchema.parse(rawPlan)
      const pattern = !plan.fallback && plan.pattern ? patternById(plan.pattern) : undefined
      if (pattern) {
        const compiled = compilePattern(pattern, plan.formation, plan.side)
        // Safety net behind the compiler — should always be clean (CI-enforced).
        const issues = validateAnimation(compiled.objects, compiled.frames, prompt)
        if (issues.length > 0) request.log.warn({ issues }, 'DSL compile issues (accepted)')
        // The compiler's geometry is always right; its FOOTBALL can still be
        // wrong for the audience. A high-press trap compiles perfectly and is
        // the wrong session for an under-9 side, and no amount of correct
        // spacing fixes that. Falling through hands the request to the
        // generation path, which has been told the age and asked to produce
        // the closest age-appropriate alternative — a better answer than
        // either shipping it or refusing outright.
        const unsuitable = [
          ...validateSquadSize(compiled.objects, ctx),
          ...validateAgeAppropriate(card?.id, ctx),
        ]
        if (unsuitable.length > 0) {
          request.log.info(
            { unsuitable, context: describeContext(ctx) },
            'DSL pattern not suitable for this age or format — falling back',
          )
        } else {
          result = { summary: plan.summary, objects: compiled.objects, frames: compiled.frames }
          source = 'dsl'
        }
      }
    } catch (err) {
      request.log.warn({ err }, 'DSL plan failed — falling back to direct generation')
    }

    // ---- Path 2 (fallback): direct coordinate generation with exemplar
    // grounding + corrective retry — unchanged behaviour.
    if (!result) {
      try {
        result = await withCorrection<AnimResult>(
          animationSystemPrompt(prompt, board, ctx),
          userPrompt(prompt),
          animationResponseSchema,
          (raw) => {
            const parsed = AnimationOutputSchema.safeParse(raw)
            if (!parsed.success) return null
            const objects = sanitiseObjects(parsed.data.objects, board)
            const frames = sanitiseFrames(parsed.data.frames, objects, board)
            if (objects.length === 0 || frames.length === 0) return null
            return {
              value: { summary: parsed.data.summary, objects, frames },
              issues: [
                ...validateAnimation(objects, frames, prompt),
                // Format and age are HARD: a squad that cannot exist is not a
                // low score, it is a picture of an impossible match.
                ...validateSquadSize(objects, ctx),
                ...validateAgeAppropriate(parsed.data.brief?.concept, ctx),
                ...validateBrief(parsed.data.brief, objects, frames, board),
                // Missing football principles are soft issues: they push the
                // corrective retry toward better football without ever
                // becoming an error the coach sees.
                ...principleIssues(validatePrinciples(requiredPrinciples, objects, frames, board)),
              ],
            }
          },
          request.log,
        )
      } catch (err) {
        request.log.error({ err }, 'AI animation generation failed')
        return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI generation failed. Please try again.' })
      }
    }
    if (!result) {
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI produced an unusable animation. Please try again.' })
    }
    const { objects, frames } = result

    // Tactical quality score on the FINAL animation, whichever path produced
    // it. Logged for measurement (and returned so the editor/PostHog can track
    // it) — never a gate: a 60/100 animation still beats no animation.
    const principleResults = validatePrinciples(requiredPrinciples, objects, frames, board)
    const quality = tacticalScore(principleResults)
    request.log.info(
      {
        source,
        // `dsl` = the compiler owned the geometry; `gemini` = the model did.
        // Aggregating this field IS the fallback rate — the number every
        // argument about pattern coverage depends on, and which nobody has
        // measured yet.
        fallback: source !== 'dsl',
        latencyMs: Date.now() - startedAt,
        quality,
        context: describeContext(ctx),
        concept: card?.id ?? 'unknown',
        missing: principleResults.filter((r) => !r.present).map((r) => r.id),
      },
      'animation tactical quality',
    )

    // Same idea, run again within the window → on us. A coach never pays twice
    // for a result they did not want.
    const uid = (request.user as { sub: number }).sub
    const { free, creditsRemaining } = await settle(uid, 'animation', prompt)
    return reply.send({
      success: true,
      prompt,
      source,
      quality,
      // Which concept card the generation was grounded in — echoed back so a
      // later coach correction can be attributed to the right concept.
      concept: card?.id ?? 'unknown',
      context: describeContext(ctx),
      freeRetry: free,
      // Below this the animation missed principles the concept requires — the
      // editor offers a free re-run rather than hoping the coach shrugs.
      retryOffered: quality < 60,
      summary: result.summary,
      scene: { objects },
      frames,
      creditsRemaining,
    })
  })

  // GET /ai-credits — balance for the editor UI ("3 credits left" badges).
  app.get('/ai-credits', async (request, reply) => {
    return reply.send(creditsForWire(await getCreditState((request.user as { sub: number }).sub)))
  })

  // POST /reel-copy — social-reel copywriting for a board (1 credit).
  // Returns hook title, subtitle, quote, three stat cards and hashtags that
  // the frontend composes into the 9:16 reel templates.
  app.post('/reel-copy', { config: { rateLimit: RATE_LIMIT } }, async (request, reply) => {
    if (!geminiConfigured()) return guardConfigured(reply)
    if ((await requireCredit(request, reply)) === null) return
    const input = ReelCopyRequestSchema.parse(request.body)

    let copy: import('./ai.schema.js').ReelCopy | null
    try {
      copy = await withCorrection(
        reelCopySystemPrompt(),
        JSON.stringify({
          boardTitle: input.boardTitle,
          notes: input.prompt ?? '',
          objects: input.objectCount,
          frames: input.frameCount,
        }),
        reelCopyResponseSchema,
        (raw) => {
          const parsed = ReelCopyOutputSchema.safeParse(raw)
          if (!parsed.success) return null
          return { value: parsed.data, issues: validateReelCopy(parsed.data) }
        },
        request.log,
      )
    } catch (err) {
      request.log.error({ err }, 'AI reel copy generation failed')
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI generation failed. Please try again.' })
    }
    if (!copy) {
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI produced unusable copy. Please try again.' })
    }

    const creditsRemaining = await recordCreditSpend((request.user as { sub: number }).sub, 'reel')
    return reply.send({ success: true, source: 'gemini', copy, creditsRemaining: remainingForWire(creditsRemaining) })
  })

  // POST /ai-correction — the coach edited an AI board and saved it.
  //
  // This is the most valuable quality signal we collect: a domain expert
  // telling us exactly what was wrong, as a by-product of their own work. It
  // must therefore never get in the way of that work — the route always
  // returns 204 quickly, and a failure to record is logged, not surfaced.
  // Fire-and-forget from the editor's save path.
  app.post('/ai-correction', async (request, reply) => {
    try {
      const input = CorrectionRequestSchema.parse(request.body)
      if (isWorthKeeping(input.diff)) {
        await (db as unknown as PrismaWithCorrections).aiCorrection.create({
          data: {
            userId: (request.user as { sub: number }).sub,
            source: input.source,
            concept: input.concept,
            quality: input.quality,
            promptHash: input.promptHash ?? null,
            context: input.context ?? null,
            diff: input.diff,
            ...correctionAggregates(input.diff),
          },
        })
      }
    } catch (err) {
      request.log.warn({ err }, 'could not record AI correction')
    }
    return reply.status(204).send()
  })

  // GET /ai-corrections/summary — "what do coaches keep fixing?"
  //
  // The consumer that stops the corrections table being a data lake. Grouped
  // by concept and source over the last N days: which concepts get edited
  // most, how heavily, and on which generation path. This list IS the pattern
  // build queue — a concept coaches keep fixing outranks any guessed roadmap.
  app.get('/ai-corrections/summary', { preHandler: requireOwner }, async (request, reply) => {
    const days = Math.min(365, Math.max(1, Number((request.query as { days?: string }).days) || 30))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const rows = (await (db as unknown as PrismaWithCorrections).aiCorrection.groupBy({
      by: ['concept', 'source'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { movedCount: true, meanShift: true, quality: true },
      orderBy: { _count: { id: 'desc' } },
    } as never)) as Array<{
      concept: string
      source: string
      _count: { _all: number }
      _avg: { movedCount: number | null; meanShift: number | null; quality: number | null }
    }>
    return reply.send({
      days,
      // Most-corrected first: the top of this list is the next pattern to build.
      concepts: rows.map((r) => ({
        concept: r.concept,
        source: r.source,
        corrections: r._count._all,
        avgObjectsMoved: Math.round((r._avg.movedCount ?? 0) * 10) / 10,
        avgShiftUnits: Math.round(r._avg.meanShift ?? 0),
        avgQualityWhenCorrected: Math.round(r._avg.quality ?? 0),
      })),
    })
  })
}
