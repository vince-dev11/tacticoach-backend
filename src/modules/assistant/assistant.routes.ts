// POST /api/assistant/ask — the coach's "Ask" button (brief 2026-10-21-help-assistant).
//
//   body  { question: string (3–500), lang?: 'en' | 'en-US' | 'de' | 'es' | 'fr' | 'it' | 'pt' | 'tr' }
//   200   { answer, sources: [{ title, url }], mode: 'ai' | 'search' | 'refused', unsure }
//   404   when ASSISTANT_ENABLED is not 'true' (the feature is behind a flag)
//
// Coaches and clubs only. Players and parents never reach this: the root
// player guard is deny-by-default and this path is not on its allow-list —
// keep it that way (a child must never be shown prices or plans).
//
// Each question is logged WITHOUT the account (locale, question, mode, the
// topics used) so the team can find gaps in the help.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { env } from '../../config/env.js'
import { db } from '../../config/database.js'
import { ASSISTANT_LANGS } from './assistant.knowledge.js'
import { ask } from './assistant.service.js'
import { captureError } from '../../lib/observability.js'

const AskSchema = z.object({
  question: z.string().trim()
    .min(3, 'Ask a question of at least 3 characters.')
    .max(500, 'Keep the question under 500 characters.'),
  lang: z.enum(ASSISTANT_LANGS).default('en'),
})

/** Until `prisma generate` knows the new model (same convention as ai_corrections). */
interface PrismaWithAssistantLog {
  assistantQuestion: { create(args: unknown): Promise<unknown> }
}

const DAILY = process.env.NODE_ENV === 'production' ? 30 : process.env.NODE_ENV === 'test' ? 10_000 : 3_000

export async function assistantRoutes(app: FastifyInstance) {
  app.post('/ask', {
    preHandler: authGuard,
    config: {
      rateLimit: {
        max: DAILY,
        timeWindow: '1 day',
        // After authGuard, so the key is the ACCOUNT: coaches share club WiFi.
        hook: 'preHandler',
        keyGenerator: (req: FastifyRequest) => String((req.user as { sub?: number } | undefined)?.sub ?? req.ip),
      },
    },
  }, async (request, reply) => {
    if (env.ASSISTANT_ENABLED !== 'true') {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Not found' })
    }
    const { question, lang } = AskSchema.parse(request.body)
    const result = await ask(question, lang)

    ;(db as unknown as PrismaWithAssistantLog).assistantQuestion
      .create({
        data: {
          locale: lang,
          question,
          mode: result.mode,
          unsure: result.unsure,
          sourceIds: result.chunkIds.join(',').slice(0, 500),
        },
      })
      .catch((err) => captureError(err, { source: 'assistant.log' }))

    return reply.send({ answer: result.answer, sources: result.sources, mode: result.mode, unsure: result.unsure })
  })
}
