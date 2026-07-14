// App factory — builds and configures the Fastify instance without starting
// it. Used by src/index.ts (real server) and by the test suite (app.inject).

import Fastify, { type FastifyInstance } from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyJwt from '@fastify/jwt'
import fastifyMultipart from '@fastify/multipart'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyHelmet from '@fastify/helmet'

import { env, corsOrigins } from './config/env.js'
import { errorHandler } from './middleware/error-handler.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { usersRoutes } from './modules/users/users.routes.js'
import { membershipRoutes } from './modules/membership/membership.routes.js'
import { canvasRoutes } from './modules/canvas/canvas.routes.js'
import { clubsRoutes } from './modules/clubs/clubs.routes.js'
import { drillSheetsRoutes } from './modules/drill-sheets/drill-sheets.routes.js'
import { stripeWebhookRoutes } from './modules/webhooks/stripe.routes.js'
import { contactRoutes } from './modules/contact/contact.routes.js'
import { aiRoutes } from './modules/ai/ai.routes.js'
import { blogRoutes } from './modules/blog/blog.routes.js'
import { adminRoutes } from './modules/admin/admin.routes.js'
import { shareRoutes } from './modules/share/share.routes.js'
import { clubPageRoutes } from './modules/club-page/club-page.routes.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: env.NODE_ENV !== 'test' })

  // ---- Error handler ----------------------------------------------------------
  // Must be set BEFORE the route plugins are registered: `await register(...)`
  // boots each plugin immediately, and encapsulated contexts capture the error
  // handler that exists at boot time. Setting it afterwards silently leaves
  // every route on Fastify's default handler (Zod errors would surface as 500s).

  app.setErrorHandler(errorHandler)

  // ---- Plugins --------------------------------------------------------------

  await app.register(fastifyHelmet)

  await app.register(fastifyCors, {
    origin: corsOrigins,
    credentials: true,
  })

  await app.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET,
  })

  await app.register(fastifyMultipart, {
    // Transport-level hard cap sized for the largest upload (the 720p preview
    // video, ≤60 MB). Each route enforces its own tighter per-type limit via
    // readUpload (thumbnails 500 KB, sheet images 2 MB, logos 5 MB).
    limits: { fileSize: 60 * 1024 * 1024 },
  })

  await app.register(fastifyRateLimit, {
    max: env.NODE_ENV === 'test' ? 10_000 : 100,
    timeWindow: '1 minute',
  })

  // ---- Routes ---------------------------------------------------------------

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(usersRoutes, { prefix: '/api/users' })
  await app.register(membershipRoutes, { prefix: '/api/membership' })
  await app.register(canvasRoutes, { prefix: '/api/canvas' })
  await app.register(clubsRoutes, { prefix: '/api/clubs' })
  await app.register(drillSheetsRoutes, { prefix: '/api/drill-sheets' })
  await app.register(stripeWebhookRoutes, { prefix: '/api/webhooks' })
  await app.register(contactRoutes, { prefix: '/api/contact' })
  // AI tactics generation lives under the canvas namespace to match the
  // editor's existing client (/api/canvas/ai-layout, /api/canvas/ai-animation).
  await app.register(aiRoutes, { prefix: '/api/canvas' })
  await app.register(blogRoutes, { prefix: '/api/blog' })
  await app.register(adminRoutes, { prefix: '/api/admin' })
  await app.register(shareRoutes, { prefix: '/api/share' })
  await app.register(clubPageRoutes, { prefix: '/api/c' })

  // ---- Health ---------------------------------------------------------------

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

  return app
}
