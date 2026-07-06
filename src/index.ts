import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyJwt from '@fastify/jwt'
import fastifyMultipart from '@fastify/multipart'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyHelmet from '@fastify/helmet'

import { env, corsOrigins } from './config/env.js'
import { db } from './config/database.js'
import { errorHandler } from './middleware/error-handler.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { usersRoutes } from './modules/users/users.routes.js'
import { membershipRoutes } from './modules/membership/membership.routes.js'
import { canvasRoutes } from './modules/canvas/canvas.routes.js'
import { clubsRoutes } from './modules/clubs/clubs.routes.js'
import { drillSheetsRoutes } from './modules/drill-sheets/drill-sheets.routes.js'
import { stripeWebhookRoutes } from './modules/webhooks/stripe.routes.js'

const app = Fastify({ logger: env.NODE_ENV !== 'test' })

// ---- Plugins ----------------------------------------------------------------

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
  max: 100,
  timeWindow: '1 minute',
})

// ---- Routes -----------------------------------------------------------------

await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(usersRoutes, { prefix: '/api/users' })
await app.register(membershipRoutes, { prefix: '/api/membership' })
await app.register(canvasRoutes, { prefix: '/api/canvas' })
await app.register(clubsRoutes, { prefix: '/api/clubs' })
await app.register(drillSheetsRoutes, { prefix: '/api/drill-sheets' })
await app.register(stripeWebhookRoutes, { prefix: '/api/webhooks' })

// ---- Health -----------------------------------------------------------------

app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

// ---- Error handler ----------------------------------------------------------

app.setErrorHandler(errorHandler)

// ---- Start ------------------------------------------------------------------

const start = async () => {
  try {
    await db.$connect()
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
    console.log(`🚀  TactiCoach API running on port ${env.PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
