// Public Collaboration Programme endpoints.
//
//   POST /api/collaborations/apply        the public form
//   GET  /api/collaborations/directory    approved, opted-in collaborators
//   GET  /api/collaborations/terms        the agreement text + version
//
// Everything a signed-in collaborator does — reading their statement, signing
// the agreement — stays on /api/referrals, because that is where their
// referral code lives and the two are the same code.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { presignUrl } from '../../config/s3.js'
import { COLLABORATION_AGREEMENT } from './collaboration-agreement.js'
import { submitApplication } from './applications.service.js'
import { collaboratorDb } from './prisma-shim.js'

/**
 * What the public form sends.
 *
 * `website` is a HONEYPOT: a field hidden from people and irresistible to the
 * bots that fill every input they find. Anything in it and we accept the
 * request politely and store nothing — telling a bot it failed only teaches
 * whoever wrote it to try again.
 */
const ApplicationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().email().max(255),
  applicantKind: z.enum(['coach', 'club']),
  organisation: z.string().trim().max(160).optional(),
  location: z.string().trim().max(120).optional(),
  links: z.string().trim().max(1000).optional(),
  audience: z.string().trim().max(200).optional(),
  why: z.string().trim().max(2000).optional(),
  // Two consents, never one. Agreeing to be contacted is not agreeing to be
  // published, and a single box covering both is consent to neither.
  consentContact: z.literal(true),
  consentListing: z.boolean(),
  website: z.string().max(200).optional(),
})

export async function collaborationsRoutes(app: FastifyInstance) {
  // The exact words, served from the API so that what somebody reads and the
  // version recorded against them come from the same place.
  app.get('/terms', async () => COLLABORATION_AGREEMENT)

  // POST /api/collaborations/apply — public, unauthenticated, sends email.
  // Same rate limit as the contact form, for the same reasons.
  app.post(
    '/apply',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const input = ApplicationSchema.parse(request.body)

      // Honeypot tripped. 200, not 400: a bot that learns it was caught is a
      // bot that comes back with the field left blank.
      if (input.website && input.website.length > 0) {
        return reply.send({ received: true })
      }

      try {
        await submitApplication(input)
      } catch (err) {
        request.log.error({ err }, 'Failed to store a collaboration application')
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'We could not record that just now. Please try again shortly.',
        })
      }

      return reply.send({ received: true })
    },
  )

  // GET /api/collaborations/directory — the public list.
  //
  // THREE conditions, all required, and all in the query rather than filtered
  // afterwards: active, opted in, and moderated. Filtering in JS would mean a
  // bug that leaks one row leaks it to the whole internet, so the database is
  // asked the question we actually mean.
  app.get('/directory', async (_request, reply) => {
    const rows = await collaboratorDb().findMany({
      where: { status: 'active', listed: true, profileApproved: true },
      orderBy: { displayName: 'asc' },
      select: {
        slug: true,
        displayName: true,
        roleTitle: true,
        organisation: true,
        location: true,
        photoKey: true,
        bio: true,
        links: true,
      },
    })

    const listed = rows as unknown as {
      slug: string | null
      displayName: string | null
      roleTitle: string | null
      organisation: string | null
      location: string | null
      photoKey: string | null
      bio: string | null
      links: string | null
    }[]

    return reply.send(
      await Promise.all(
        listed
          // A row with no slug has never been published and has no URL to sit
          // at. Belt and braces behind the query above.
          .filter((c) => !!c.slug && !!c.displayName)
          .map(async (c) => ({
            slug: c.slug,
            name: c.displayName,
            role: c.roleTitle,
            organisation: c.organisation,
            location: c.location,
            photoUrl: c.photoKey ? await presignUrl(c.photoKey) : null,
            bio: c.bio,
            // Stored as one field, published as a list. Split here rather than
            // in the client so every surface gets the same parsing.
            links: (c.links ?? '')
              .split(/[\n,]/)
              .map((l) => l.trim())
              .filter((l) => /^https?:\/\//i.test(l))
              .slice(0, 5),
          })),
      ),
    )
  })

  // GET /api/collaborations/directory/:slug — one entry.
  app.get('/directory/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const found = (await collaboratorDb().findMany({
      where: { slug, status: 'active', listed: true, profileApproved: true },
      select: {
        slug: true,
        displayName: true,
        roleTitle: true,
        organisation: true,
        location: true,
        photoKey: true,
        bio: true,
        links: true,
      },
    })) as unknown as Record<string, string | null>[]

    const one = found[0]
    if (!one) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'No such collaborator' })
    }
    return reply.send({
      slug: one.slug,
      name: one.displayName,
      role: one.roleTitle,
      organisation: one.organisation,
      location: one.location,
      photoUrl: one.photoKey ? await presignUrl(one.photoKey) : null,
      bio: one.bio,
      links: (one.links ?? '')
        .split(/[\n,]/)
        .map((l) => l.trim())
        .filter((l) => /^https?:\/\//i.test(l))
        .slice(0, 5),
    })
  })
}
