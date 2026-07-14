// AI tactical generator — POST /api/canvas/ai-layout and /ai-animation.
//
// Wire contract matches the editor client (frontend src/editor/api.ts):
//   ai-layout    → { success, prompt, source, summary, layout: Item[] }
//   ai-animation → { success, prompt, source, summary, scene: { objects }, frames: [{ moves }] }
//
// Both routes require login + editor entitlement (trial/subscription/club
// seat) and carry a per-user rate limit — each call costs a Gemini request.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireEditorAccess } from '../../middleware/entitlement-guard.js'
import { geminiConfigured, generateTacticsJson, GeminiError } from '../../config/gemini.js'
import { layoutSystemPrompt, animationSystemPrompt, userPrompt } from './ai.prompts.js'
import {
  RequestSchema,
  LayoutOutputSchema,
  AnimationOutputSchema,
  sanitiseObjects,
  sanitiseFrames,
} from './ai.schema.js'

const RATE_LIMIT = {
  max: 20,
  timeWindow: '10 minutes',
  // Per-user, not per-IP: authenticated routes, and coaches often share club WiFi.
  keyGenerator: (req: FastifyRequest) =>
    String((req.user as { sub?: number } | undefined)?.sub ?? req.ip),
} as const

/** Call Gemini, retrying once — LLM output is occasionally malformed. */
async function generateWithRetry(system: string, user: string): Promise<unknown> {
  try {
    return await generateTacticsJson(system, user)
  } catch (err) {
    if (err instanceof GeminiError && err.retryable) {
      return generateTacticsJson(system, user)
    }
    throw err
  }
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

  // POST /ai-layout — static board setup from natural language
  app.post('/ai-layout', { config: { rateLimit: RATE_LIMIT } }, async (request, reply) => {
    if (!geminiConfigured()) return guardConfigured(reply)
    const { prompt } = RequestSchema.parse(request.body)

    let raw: unknown
    try {
      raw = await generateWithRetry(layoutSystemPrompt(), userPrompt(prompt))
    } catch (err) {
      request.log.error({ err }, 'AI layout generation failed')
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI generation failed. Please try again.' })
    }

    const parsed = LayoutOutputSchema.safeParse(raw)
    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, 'AI layout output failed validation')
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI produced an unusable layout. Please try again.' })
    }

    const layout = sanitiseObjects(parsed.data.objects)
    if (layout.length === 0) {
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI produced an empty layout. Please try again.' })
    }

    return reply.send({
      success: true,
      prompt,
      source: 'gemini',
      summary: parsed.data.summary,
      layout,
    })
  })

  // POST /ai-animation — initial scene + movement frames
  app.post('/ai-animation', { config: { rateLimit: RATE_LIMIT } }, async (request, reply) => {
    if (!geminiConfigured()) return guardConfigured(reply)
    const { prompt } = RequestSchema.parse(request.body)

    let raw: unknown
    try {
      raw = await generateWithRetry(animationSystemPrompt(), userPrompt(prompt))
    } catch (err) {
      request.log.error({ err }, 'AI animation generation failed')
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI generation failed. Please try again.' })
    }

    const parsed = AnimationOutputSchema.safeParse(raw)
    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, 'AI animation output failed validation')
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI produced an unusable animation. Please try again.' })
    }

    const objects = sanitiseObjects(parsed.data.objects)
    const frames = sanitiseFrames(parsed.data.frames, objects)
    if (objects.length === 0 || frames.length === 0) {
      return reply.status(502).send({ statusCode: 502, error: 'Bad Gateway', message: 'AI produced an unusable animation. Please try again.' })
    }

    return reply.send({
      success: true,
      prompt,
      source: 'gemini',
      summary: parsed.data.summary,
      scene: { objects },
      frames,
    })
  })
}
