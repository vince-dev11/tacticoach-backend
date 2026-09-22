// The Collaboration Programme: coaches and clubs who are paid commission
// rather than credit, and who hold a comped account because they cannot sell a
// product they have no way to open.
//
// The split from the referral programme is deliberate. A referrer is a
// customer who happens to recommend us; a collaborator is a SUPPLIER we owe
// money to. They need different records (a ledger that survives a dispute),
// different rules (notice periods, trailing commission) and different failure
// modes.
//
// ---- Why "collaborator" and not "partner" ---------------------------------
//
// In England and Wales a partnership is a legal entity whose members are
// jointly liable for one another's debts. The old agreement had to spend a
// clause denying it was one — using a word that means something else and then
// disclaiming it. "Collaborator" carries no such baggage.

import { db } from '../../config/database.js'
import { isClubPlan } from '../../lib/capabilities.js'
import { ensureReferralCode } from '../referrals/referrals.service.js'
import { COLLABORATION_AGREEMENT_VERSION } from './collaboration-agreement.js'
// The programme's numbers live in a leaf module so the agreement — which
// interpolates them into its text — can read them without importing this file
// and creating a cycle. Re-exported here because callers expect them from the
// service, and one import path is kinder than two.
import {
  COMMISSION_WINDOW_MONTHS,
  DEFAULT_COACH_RATE,
  DEFAULT_CLUB_RATE,
  PAYOUT_THRESHOLD_PENCE,
  CONTENT_PER_CYCLE,
  CONTENT_VIDEO_MINIMUM,
  nextPayoutDate,
} from './collaboration-terms.js'

export {
  COMMISSION_WINDOW_MONTHS,
  DEFAULT_COACH_RATE,
  DEFAULT_CLUB_RATE,
  PAYOUT_THRESHOLD_PENCE,
  PAYOUT_MONTHS,
  CONTENT_PER_CYCLE,
  CONTENT_VIDEO_MINIMUM,
  nextPayoutDate,
} from './collaboration-terms.js'
// TEMPORARY — see prisma-shim.ts. Swap back to db.collaborator /
// db.collaboratorCommission once `prisma generate` has run against migration 17.
import { collaboratorDb, commissionDb } from './prisma-shim.js'

/** Comped plan a collaborator is given — defined with the rules it drives. */
export { COLLABORATION_PLAN_SLUG } from '../../lib/entitlements.js'

export function isCollaboratorActive(c: { status: string } | null | undefined): boolean {
  return c?.status === 'active'
}

/**
 * Invite a coach or club onto the programme. They land in `invited` — no
 * commission, no comped account — until they accept the agreement in the app.
 *
 * Returns their code, which is the same code they already use for ordinary
 * referrals: somebody who was recommending us before they signed must not have
 * the link on their existing slides stop working the day they do.
 */
export async function inviteCollaborator(params: {
  userId: number
  coachRate?: number
  clubRate?: number
  companyName?: string | null
  notes?: string | null
}): Promise<{ code: string }> {
  const {
    userId,
    coachRate = DEFAULT_COACH_RATE,
    clubRate = DEFAULT_CLUB_RATE,
    companyName = null,
    notes = null,
  } = params
  const code = await ensureReferralCode(userId)

  await collaboratorDb().upsert({
    where: { userId },
    // Re-inviting somebody who already accepted must not silently reset them
    // to `invited` and pull their account out from under them, so status is
    // left alone on update — use the admin status route to change it
    // deliberately.
    update: { coachRate, clubRate, companyName, notes, endedAt: null },
    create: { userId, coachRate, clubRate, companyName, notes, status: 'invited' },
  })
  return { code }
}

/**
 * They accepted the agreement. This is the moment they become active:
 * commission starts accruing and the comped Pro account switches on.
 *
 * The version and IP are recorded because "what exactly did they agree to" is
 * the only question that matters if this is ever disputed, and "the current
 * contents of a file in our repo" is not an answer.
 */
export async function acceptAgreement(userId: number, ip: string | null): Promise<boolean> {
  const collaborator = await collaboratorDb().findUnique({
    where: { userId },
    select: { status: true },
  })
  if (!collaborator) return false
  // Only an invitation can be accepted. Re-posting must not resurrect somebody
  // who was suspended or whose collaboration has ended.
  if (collaborator.status !== 'invited') return collaborator.status === 'active'

  await collaboratorDb().update({
    where: { userId },
    data: {
      status: 'active',
      agreementSignedAt: new Date(),
      agreementVersion: COLLABORATION_AGREEMENT_VERSION,
      agreementIp: ip,
      startedAt: new Date(),
    },
  })
  return true
}

/**
 * End a collaboration. Their comped access stops, but the commission already
 * on the ledger is untouched: the agreement promises trailing commission on
 * customers introduced before it ended, and a statement that silently loses
 * lines is the fastest way to a dispute.
 */
export async function endCollaborator(userId: number): Promise<void> {
  await collaboratorDb().updateMany({
    where: { userId },
    data: { status: 'ended', endedAt: new Date() },
  })
}

/**
 * Which rate applies to a payment, from the plan that payment is FOR.
 *
 * Resolved per invoice rather than locked at the customer's first payment, and
 * that is a deliberate choice with two arguments behind it:
 *
 *   SIMPLER. Commission is already computed per invoice and the rate is
 *   already copied onto the line. Locking it would need a column to lock it
 *   in.
 *
 *   ALIGNED. A coach introduced at the coach rate who upgrades to a club plan
 *   moves their collaborator to the club rate from that invoice onward. That
 *   gives the collaborator a reason to help a coach grow into a club, which is
 *   the single most valuable thing they could do for us. Locking would pay
 *   them LESS for the better outcome.
 */
export function rateForPlan(
  planSlug: string | null | undefined,
  rates: { coachRate: number; clubRate: number },
): number {
  return isClubPlan(planSlug) ? rates.clubRate : rates.coachRate
}

/**
 * Record commission on a payment that has actually cleared.
 *
 * Keyed on the Stripe invoice id, so a retried webhook cannot pay twice — and
 * the rate is copied onto the row rather than read back from the collaborator
 * later, because a rate change must apply forwards only.
 */
export async function recordCommission(params: {
  customerId: number
  providerInvoiceId: string
  netAmount: number
  currency: string
}): Promise<void> {
  const { customerId, providerInvoiceId, netAmount, currency } = params
  if (netAmount <= 0) return

  const referral = await db.referral.findUnique({
    where: { referredUserId: customerId },
    select: { referrerId: true, status: true, qualifiedAt: true, createdAt: true },
  })
  if (!referral || referral.status === 'reversed') return

  const collaborator = await collaboratorDb().findUnique({
    where: { userId: referral.referrerId },
    select: { id: true, status: true, coachRate: true, clubRate: true },
  })
  // Ended collaborators keep earning on customers they already introduced;
  // suspended ones do not. Only `ended` is in the trailing-commission promise
  // — and `invited` has not agreed to anything yet, so nothing is owed.
  if (!collaborator || collaborator.status === 'suspended' || collaborator.status === 'invited') {
    return
  }

  // The 12-month window runs from the customer's first payment, not from today.
  const start = referral.qualifiedAt ?? referral.createdAt
  const windowEnds = new Date(start)
  windowEnds.setMonth(windowEnds.getMonth() + COMMISSION_WINDOW_MONTHS)
  if (new Date() > windowEnds) return

  // What the CUSTOMER is on right now — which is what this invoice is for.
  const customerPlan = await db.userSubscription.findUnique({
    where: { userId: customerId },
    select: { plan: { select: { slug: true } } },
  })

  const rate = rateForPlan(customerPlan?.plan.slug, {
    coachRate: Number(collaborator.coachRate),
    clubRate: Number(collaborator.clubRate),
  })
  const commissionAmount = Math.round(netAmount * rate)

  try {
    await commissionDb().create({
      data: {
        collaboratorId: collaborator.id,
        customerId,
        providerInvoiceId,
        netAmount,
        rate,
        commissionAmount,
        currency: currency.toUpperCase(),
      },
    })
  } catch {
    // Unique on provider_invoice_id — this invoice is already on the statement.
  }
}

/** Reverse a statement line after a refund or chargeback. */
export async function reverseCommission(providerInvoiceId: string): Promise<void> {
  await commissionDb().updateMany({
    where: { providerInvoiceId, reversedAt: null },
    data: { reversedAt: new Date() },
  })
}

export interface CollaborationStatement {
  status: string
  /** True while they have been invited but have not accepted the agreement. */
  awaitingAgreement: boolean
  agreementVersion: string | null
  agreementSignedAt: Date | null
  code: string
  coachRate: number
  clubRate: number
  companyName: string | null
  startedAt: Date
  endedAt: Date | null
  currency: string
  /** Earned, not reversed, not yet paid out. */
  balancePence: number
  lifetimePence: number
  payoutThresholdPence: number
  payable: boolean
  /** When the next payout runs — three fixed dates a year. */
  nextPayoutAt: Date
  contentPerCycle: number
  contentVideoMinimum: number
  customers: { firstName: string; joinedAt: Date; status: string }[]
  lines: {
    customerFirstName: string
    netAmount: number
    commissionAmount: number
    rate: number
    currency: string
    createdAt: Date
    reversedAt: Date | null
    paidOutAt: Date | null
  }[]
}

export async function getCollaborationStatement(
  userId: number,
): Promise<CollaborationStatement | null> {
  const collaborator = await collaboratorDb().findUnique({
    where: { userId },
    select: {
      id: true,
      status: true,
      coachRate: true,
      clubRate: true,
      companyName: true,
      startedAt: true,
      endedAt: true,
      agreementVersion: true,
      agreementSignedAt: true,
    },
  })
  if (!collaborator) return null

  const [code, lines, referrals] = await Promise.all([
    ensureReferralCode(userId),
    commissionDb().findMany({
      where: { collaboratorId: collaborator.id },
      orderBy: { createdAt: 'desc' },
      select: {
        netAmount: true,
        commissionAmount: true,
        rate: true,
        currency: true,
        createdAt: true,
        reversedAt: true,
        paidOutAt: true,
        customer: { select: { name: true } },
      },
    }),
    db.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, createdAt: true, referred: { select: { name: true } } },
    }),
  ])

  const live = lines.filter((l) => !l.reversedAt)
  const balancePence = live.filter((l) => !l.paidOutAt).reduce((s, l) => s + l.commissionAmount, 0)

  return {
    status: collaborator.status,
    awaitingAgreement: collaborator.status === 'invited',
    agreementVersion: collaborator.agreementVersion,
    agreementSignedAt: collaborator.agreementSignedAt,
    code,
    coachRate: Number(collaborator.coachRate),
    clubRate: Number(collaborator.clubRate),
    companyName: collaborator.companyName,
    startedAt: collaborator.startedAt,
    endedAt: collaborator.endedAt,
    currency: live[0]?.currency ?? 'GBP',
    balancePence,
    lifetimePence: live.reduce((s, l) => s + l.commissionAmount, 0),
    payoutThresholdPence: PAYOUT_THRESHOLD_PENCE,
    payable: balancePence >= PAYOUT_THRESHOLD_PENCE,
    nextPayoutAt: nextPayoutDate(),
    contentPerCycle: CONTENT_PER_CYCLE,
    contentVideoMinimum: CONTENT_VIDEO_MINIMUM,
    customers: referrals.map((r) => ({
      firstName: r.referred.name,
      joinedAt: r.createdAt,
      status: r.status,
    })),
    lines: lines.map((l) => ({
      customerFirstName: l.customer.name,
      netAmount: l.netAmount,
      commissionAmount: l.commissionAmount,
      rate: Number(l.rate),
      currency: l.currency,
      createdAt: l.createdAt,
      reversedAt: l.reversedAt,
      paidOutAt: l.paidOutAt,
    })),
  }
}
