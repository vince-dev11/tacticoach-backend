// /api/admin/analytics/* — owner-only, mounted inside adminRoutes (which
// already applies authGuard + requireOwner to everything under it).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { apiVitals, countriesView, featuresView, funnelsView, healthView, pageSpeedView, posthogFeaturesByCountry, sourceStatuses } from './analytics.service.js'
import { RANGES, rangeOf } from './sources.js'
import { retentionView, stuckView, timelineView, topCoaches, trafficView, usageView } from './activity.service.js'

// ANALYTICS-DATES: a preset (7d / 30d / 90d) or any from–to (YYYY-MM-DD).
const Query = z.object({
  range: z.enum(RANGES as [string, ...string[]]).default('30d'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
const period = (q: unknown) => rangeOf(Query.parse(q))

export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/analytics/status', async () => ({ sources: sourceStatuses(), ranges: RANGES }))

  app.get('/analytics/countries', async (request) => {
    const range = period(request.query)
    return countriesView(range)
  })

  app.get('/analytics/features', async (request) => {
    const range = period(request.query)
    const [main, posthog] = await Promise.all([featuresView(range), posthogFeaturesByCountry(range)])
    return { ...main, posthog }
  })

  app.get('/analytics/funnels', async (request) => {
    const range = period(request.query)
    return funnelsView(range)
  })

  app.get('/analytics/health', async (request) => {
    const range = period(request.query)
    return healthView(range)
  })

  // ACTIVITY-LOG (23 Nov 2026): our own record of what coaches do.
  app.get('/analytics/usage', async (request) => usageView(period(request.query)))
  app.get('/analytics/retention', async (request) => retentionView(period(request.query)))
  app.get('/analytics/stuck', async (request) => stuckView(period(request.query)))
  app.get('/analytics/coaches', async (request) => ({ coaches: await topCoaches(period(request.query)) }))
  app.get('/analytics/coaches/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    if (!Number.isInteger(id) || id <= 0) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Not found' })
    const view = await timelineView(id, period(request.query))
    if (!view.user) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Not found' })
    return view
  })
  // Where the website's visitors come from (GA4) and how leads heard about us.
  app.get('/analytics/traffic', async (request) => trafficView(period(request.query)))

  /** Live process vitals + last-hour request timings. Not cached. */
  app.get('/analytics/performance', async () => apiVitals())

  /** Google PageSpeed for the public site (mobile + desktop). Cached an hour. */
  app.get('/analytics/pagespeed', async () => pageSpeedView())
}
