// /api/admin/analytics/* — owner-only, mounted inside adminRoutes (which
// already applies authGuard + requireOwner to everything under it).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { apiVitals, countriesView, featuresView, funnelsView, healthView, pageSpeedView, posthogFeaturesByCountry, sourceStatuses } from './analytics.service.js'
import { RANGES } from './sources.js'

const Query = z.object({ range: z.enum(RANGES as [string, ...string[]]).default('30d') })
type RangeQ = (typeof RANGES)[number]

export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/analytics/status', async () => ({ sources: sourceStatuses(), ranges: RANGES }))

  app.get('/analytics/countries', async (request) => {
    const { range } = Query.parse(request.query)
    return countriesView(range as RangeQ)
  })

  app.get('/analytics/features', async (request) => {
    const { range } = Query.parse(request.query)
    const [main, posthog] = await Promise.all([featuresView(range as RangeQ), posthogFeaturesByCountry(range as RangeQ)])
    return { ...main, posthog }
  })

  app.get('/analytics/funnels', async (request) => {
    const { range } = Query.parse(request.query)
    return funnelsView(range as RangeQ)
  })

  app.get('/analytics/health', async (request) => {
    const { range } = Query.parse(request.query)
    return healthView(range as RangeQ)
  })

  /** Live process vitals + last-hour request timings. Not cached. */
  app.get('/analytics/performance', async () => apiVitals())

  /** Google PageSpeed for the public site (mobile + desktop). Cached an hour. */
  app.get('/analytics/pagespeed', async () => pageSpeedView())
}
