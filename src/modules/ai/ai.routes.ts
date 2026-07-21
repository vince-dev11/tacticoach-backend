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
import { getCreditState, recordCreditSpend } from '../../lib/credits.js'
import { layoutSystemPrompt, animationSystemPrompt, reelCopySystemPrompt, userPrompt } from './ai.prompts.js'
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
} from './ai.schema.js'
import { validateLayout, validateAnimation, validateReelCopy } from './ai.validate.js'

const RATE_LIMIT = {
  max: 20,
  timeWindow: '10 minutes',
  // Per-user, not per-IP: authenticated routes, and coaches often share club WiFi.
  keyGenerator: (req: FastifyRequest) =>
    String((req.user as { sub?: number } | undefined)?.sub ?? req.ip),
} as const

/** Call Gemini, retrying once — transport errors and refusals are transient. */
async function generateWithRetry(
  system: string,
  user: string,
  options?: Parameters<typeof generateTacticsJson>[2],
): Promise<unknown> {
  try {
    return await generateTacticsJson(system, user, options)
  } catch (err) {
    if (err instanceof GeminiError && err.retryable) {
      return generateTacticsJson(system, user, options)
    }
    throw err
  }
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
        credits: state,
      })
      return null
    }
    return state
  }

  // POST /ai-layout — static board setup from natural language
  app.post('/ai-layout', { config: { rateLimit: RATE_LIMIT } }, async (request, reply) => {
    if (!geminiConfigured()) return guardConfigured(reply)
    if ((await requireCredit(request, reply)) === null) return
    const { prompt } = RequestSchema.parse(request.body)

    let result: { summary: string; layout: ReturnType<typeof sanitiseObjects> } | null
    try {
      result = await withCorrection(
        layoutSystemPrompt(),
        userPrompt(prompt),
        layoutResponseSchema,
        (raw) => {
          const parsed = LayoutOutputSchema.safeParse(raw)
          if (!parsed.success) return null
          const layout = sanitiseObjects(parsed.data.objects)
          if (layout.length === 0) return null
          return { value: { summary: parsed.data.summary, layout }, issues: validateLayout(layout, prompt) }
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

    const creditsRemaining = await recordCreditSpend((request.user as { sub: number }).sub, 'layout')
    return reply.send({
      success: true,
      prompt,
      source: 'gemini',
      summary: result.summary,
      layout: result.layout,
      creditsRemaining,
    })
  })

  // POST /ai-animation — initial scene + movement frames
  app.post('/ai-animation', { config: { rateLimit: RATE_LIMIT } }, async (request, reply) => {
    if (!geminiConfigured()) return guardConfigured(reply)
    if ((await requireCredit(request, reply)) === null) return
    const { prompt } = RequestSchema.parse(request.body)

    interface AnimResult {
      summary: string
      objects: ReturnType<typeof sanitiseObjects>
      frames: ReturnType<typeof sanitiseFrames>
    }
    let result: AnimResult | null
    try {
      result = await withCorrection<AnimResult>(
        animationSystemPrompt(),
        userPrompt(prompt),
        animationResponseSchema,
        (raw) => {
          const parsed = AnimationOutputSchema.safeParse(raw)
          if (!parsed.success) return null
          const objects = sanitiseObjects(parsed.data.objects)
          const frames = sanitiseFrames(parsed.data.frames, objects)
          if (objects.length === 0 || frames.length === 0) return null
          return {
            value: { summary: parsed.data.summary, objects, frames },
            issues: validateAnimation(objects, frames, prompt),
          }
        },
        request.log,
      )
    } catch (err) {
      request.log.error({ err }, 'AI animation generation failed')
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI generation failed. Please try again.' })
    }
    if (!result) {
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI produced an unusable animation. Please try again.' })
    }
    const { objects, frames } = result

    const creditsRemaining = await recordCreditSpend((request.user as { sub: number }).sub, 'animation')
    return reply.send({
      success: true,
      prompt,
      source: 'gemini',
      summary: result.summary,
      scene: { objects },
      frames,
      creditsRemaining,
    })
  })

  // GET /ai-credits — balance for the editor UI ("3 credits left" badges).
  app.get('/ai-credits', async (request, reply) => {
    return reply.send(await getCreditState((request.user as { sub: number }).sub))
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
    return reply.send({ success: true, source: 'gemini', copy, creditsRemaining })
  })
}
