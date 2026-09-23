// Referral + collaboration endpoints.
//
//   GET /api/referrals/lookup?code=…  public — "Invited by Priya" on signup
//   GET /api/referrals/me             code, link, ladder progress, credit —
//                                     or { agreementRequired } until signed
//   GET /api/referrals/agreement      the referral terms + version
//   POST /api/referrals/accept        accept them — this is what opens it
//   GET /api/referrals/collaboration        the statement (404 if not one)
//   GET /api/referrals/collaboration/agreement   the agreement text + version
//   POST /api/referrals/collaboration/accept     accept it — this is what activates them

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { latinOnly } from '../../lib/latin-only.js'
import { db } from '../../config/database.js'
import { getReferralSummary } from './referrals.service.js'
import { getCollaborationStatement, acceptAgreement } from '../collaborations/collaborations.service.js'
import { COLLABORATION_AGREEMENT } from '../collaborations/collaboration-agreement.js'
import { REFERRAL_AGREEMENT, REFERRAL_AGREEMENT_VERSION } from './referral-agreement.js'
import {
  hasAccepted, recordAcceptance, getAcceptance, signatureProblem,
  type AgreementKind,
} from '../../lib/agreements.js'
import { renderSignedAgreement } from '../../lib/agreement-pdf.js'

/** The signed-in user's id, as every other route reads it off the JWT payload. */
function userId(request: { user: unknown }): number {
  return (request.user as { sub: number }).sub
}

const LookupQuery = z.object({ code: z.string().min(1).max(24) })

/**
 * What signing requires. A tick box is no longer the signature.
 *
 * `name` is what the SIGNER types, not their account name — a club secretary
 * signing for the club, or somebody whose account says "Vince" but who signs
 * "Vincent Okafor". Latin-only for the same reason as every other name in the
 * product: it has to render in a PDF.
 */
const SignatureSchema = z.object({
  name: latinOnly(z.string().trim().min(2).max(160)),
  signature: z.string().min(1).max(400_000),
})

/** Validate the drawn image and answer with something a person can act on. */
function badSignature(signature: string): string | null {
  return signatureProblem(signature)
}

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

    // GET /api/referrals/me — the code, the ladders, the credit.
    //
    // GATED ON THE TERMS. Somebody has to agree to the rules before they start
    // recommending us, and this endpoint is where the gate belongs rather than
    // deeper in the service: getReferralSummary mints the referral code on
    // first call, so returning early here means an unsigned account never gets
    // a code at all — there is nothing to share and therefore nothing to
    // attribute. The alternative, minting the code and hiding it in the UI,
    // leaves a working link one devtools panel away.
    //
    // COLLABORATORS ARE EXEMPT. Their own agreement already covers referrals in far
    // more detail, they signed it to become a collaborator, and asking them to
    // accept a second, weaker set of terms for the same activity would be
    // confusing at best and arguably contradictory.
    scoped.get('/me', async (request) => {
      const id = userId(request)
      const collaborator = await db.collaborator.findUnique({
        where: { userId: id },
        select: { status: true },
      })
      const exempt = collaborator?.status === 'active'

      if (!exempt) {
        const signedAt = await hasAccepted(id, 'referral', REFERRAL_AGREEMENT_VERSION)
        if (!signedAt) {
          return {
            agreementRequired: true as const,
            agreement: REFERRAL_AGREEMENT,
          }
        }
      }
      return { agreementRequired: false as const, ...(await getReferralSummary(id)) }
    })

    // The exact words, served from the API so that what somebody reads and the
    // version recorded against them come from the same place.
    scoped.get('/agreement', async () => REFERRAL_AGREEMENT)

    // POST /api/referrals/accept — the click that opens the programme.
    scoped.post('/accept', async (request, reply) => {
      const id = userId(request)
      const input = SignatureSchema.parse(request.body)
      const problem = badSignature(input.signature)
      if (problem) {
        return reply.status(422).send({
          statusCode: 422, error: 'Unprocessable Entity', message: problem,
        })
      }
      // request.ip is only trustworthy behind a correctly configured proxy; it
      // is evidence of what we recorded, not proof of origin, and the terms
      // describe it that way.
      await recordAcceptance(id, 'referral', REFERRAL_AGREEMENT_VERSION, request.ip ?? null, input)
      return { agreementRequired: false as const, ...(await getReferralSummary(id)) }
    })

    // GET /api/referrals/agreement/:kind/pdf — the signed copy.
    //
    // Rendered ON DEMAND from the stored record rather than saved as a file at
    // signing time. A contract somebody can only download in the ten seconds
    // after they sign is not much of a contract; this one can be produced
    // again in two years, from the same record that proves it.
    scoped.get('/agreement/:kind/pdf', async (request, reply) => {
      const kind = (request.params as { kind: string }).kind as AgreementKind
      if (kind !== 'referral' && kind !== 'collaboration') {
        return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Unknown agreement' })
      }
      const record = await getAcceptance(userId(request), kind)
      if (!record) {
        return reply.status(404).send({
          statusCode: 404, error: 'Not Found', message: 'Nothing signed on this account yet',
        })
      }
      const doc = kind === 'collaboration' ? COLLABORATION_AGREEMENT : REFERRAL_AGREEMENT
      const pdf = await renderSignedAgreement(doc, record)
      return reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `attachment; filename="TactiCoach-${kind}-agreement.pdf"`,
        )
        .send(pdf)
    })

    scoped.get('/collaboration', async (request, reply) => {
      const statement = await getCollaborationStatement(userId(request))
      if (!statement) return reply.status(404).send({ message: 'Not a collaborator' })
      return statement
    })

    // The exact words they are being asked to agree to. Served from the API
    // rather than baked into the frontend bundle so the text a collaborator accepts
    // and the version recorded against them come from the same place.
    scoped.get('/collaboration/agreement', async () => COLLABORATION_AGREEMENT)

    // POST /api/referrals/collaboration/accept — the click that activates them.
    scoped.post('/collaboration/accept', async (request, reply) => {
      const input = SignatureSchema.parse(request.body)
      const problem = badSignature(input.signature)
      if (problem) {
        return reply.status(422).send({
          statusCode: 422, error: 'Unprocessable Entity', message: problem,
        })
      }
      // Behind a proxy, request.ip is only trustworthy if trustProxy is set; it
      // is evidence of what we recorded, not proof of origin, and is treated
      // that way in the agreement.
      const ok = await acceptAgreement(userId(request), request.ip ?? null)
      if (!ok) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'There is no open collaboration invitation on this account',
        })
      }
      // Also recorded in agreement_acceptances, which is where the name and
      // the signature live. The `collaborators` row keeps its own signed-at and
      // version as before — untouched rather than migrated, because moving
      // live commercial records is not something to bundle into a feature.
      await recordAcceptance(
        userId(request), 'collaboration', COLLABORATION_AGREEMENT.version, request.ip ?? null, input,
      )
      return getCollaborationStatement(userId(request))
    })
  })
}
