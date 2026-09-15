// Referral + partner endpoints.
//
//   GET /api/referrals/lookup?code=…  public — "Invited by Priya" on signup
//   GET /api/referrals/me             code, link, ladder progress, credit
//   GET /api/referrals/partner        the partner statement (404 if not one)
//   GET /api/referrals/partner/agreement   the agreement text + version
//   POST /api/referrals/partner/accept     accept it — this is what activates them

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { db } from '../../config/database.js'
import { getReferralSummary } from './referrals.service.js'
import { getPartnerStatement, acceptAgreement } from '../partners/partners.service.js'
import { PARTNER_AGREEMENT } from '../partners/partner-agreement.js'

/** The signed-in user's id, as every other route reads it off the JWT payload. */
function userId(request: { user: unknown }): number {
  return (request.user as { sub: number }).sub
}

const LookupQuery = z.object({ code: z.string().min(1).max(24) })

export async function referralsRoutes(app: FastifyInstance) {
  // ---- Public ---------------------------------------------------------------

  // Returns the inviter's FIRST NAME only. Codes are short and guessable, so a
  // lookup that echoed an email address would be a free enumeration tool.
  // Rate-limited for the same reason.
  app.get('/lookup', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const parsed = LookupQuery.safeParse(request.query)
    if (!parsed.success) return { valid: false, firstName: null }

    const owner = await db.user.findUnique({
      where: { referralCode: parsed.data.code.trim().toUpperCase() },
      select: { name: true },
    })
    return { valid: !!owner, firstName: owner?.name ?? null }
  })

  // ---- Signed in ------------------------------------------------------------
  // Nested scope so the guard covers these and not the public lookup above.
  await app.register(async (scoped) => {
    scoped.addHook('onRequest', authGuard)

    scoped.get('/me', async (request) => getReferralSummary(userId(request)))

    scoped.get('/partner', async (request, reply) => {
      const statement = await getPartnerStatement(userId(request))
      if (!statement) return reply.status(404).send({ message: 'Not a partner' })
      return statement
    })

    // The exact words they are being asked to agree to. Served from the API
    // rather than baked into the frontend bundle so the text a partner accepts
    // and the version recorded against them come from the same place.
    scoped.get('/partner/agreement', async () => PARTNER_AGREEMENT)

    // POST /api/referrals/partner/accept — the click that activates them.
    scoped.post('/partner/accept', async (request, reply) => {
      // Behind a proxy, request.ip is only trustworthy if trustProxy is set; it
      // is evidence of what we recorded, not proof of origin, and is treated
      // that way in the agreement.
      const ok = await acceptAgreement(userId(request), request.ip ?? null)
      if (!ok) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'There is no open partner invitation on this account',
        })
      }
      return getPartnerStatement(userId(request))
    })
  })
}
