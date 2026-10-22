// ONBOARDING-EMAIL (20 Oct 2026) · POST /api/webhooks/email?token=… — bounce
// and complaint events from the email provider (Brevo). The shared token in
// the URL is the authentication (Brevo lets you set the notify URL; it does
// not sign requests). Unset EMAIL_WEBHOOK_TOKEN = the route answers 404.

import type { FastifyInstance } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import { env } from '../../config/env.js'
import { applyBounce, type BounceEvent } from '../../lib/email-bounce.js'

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export async function emailWebhookRoutes(app: FastifyInstance) {
  app.post('/email', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    const token = (request.query as { token?: string }).token ?? ''
    if (!env.EMAIL_WEBHOOK_TOKEN || !same(token, env.EMAIL_WEBHOOK_TOKEN)) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Not found' })
    }
    // Brevo posts one event per request; accept a batch too.
    const body = request.body as BounceEvent | BounceEvent[] | undefined
    const events = Array.isArray(body) ? body : body ? [body] : []
    let marked = 0
    for (const ev of events.slice(0, 100)) if (await applyBounce(ev)) marked++
    return reply.send({ received: events.length, marked })
  })
}
