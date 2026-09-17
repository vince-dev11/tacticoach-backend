// The Partner Programme: invited coaches who are paid commission rather than
// credit, and who hold a comped account because they cannot sell a product they
// have no way to open.
//
// The split from the referral programme is deliberate. A referrer is a customer
// who happens to recommend us; a partner is a supplier we owe money to. They
// need different records (a ledger that survives a dispute), different rules
// (30 days' notice, trailing commission) and different failure modes.

import { db } from '../../config/database.js'
import { ensureReferralCode } from '../referrals/referrals.service.js'
import { PARTNER_AGREEMENT_VERSION } from './partner-agreement.js'

/** Comped plan a partner is given — defined with the entitlement rules it drives. */
export { PARTNER_PLAN_SLUG } from '../../lib/entitlements.js'

/** Commission is earned for this long after each customer's first payment. */
export const COMMISSION_WINDOW_MONTHS = 12

export function isPartnerActive(p: { status: string } | null | undefined): boolean {
  return p?.status === 'active'
}

/**
 * Invite a coach onto the programme. They land in `invited` — no commission, no
 * comped account — until they accept the agreement in the app.
 *
 * Returns their code, which is the same code they already use for ordinary
 * referrals: a partner who was recommending us before they signed must not have
 * the link on their existing slides stop working the day they do.
 */
export async function invitePartner(params: {
  userId: number
  commissionRate?: number
  companyName?: string | null
  notes?: string | null
}): Promise<{ code: string }> {
  // 0.15 = 15%. A FRACTION, never a percent — the route caps it at 1 so that
  // typing "15" meaning 15% cannot commit us to fifteen times the revenue.
  //
  // Changed from 0.20 on 2026-09-17. This is the default for NEW invitations
  // only: the rate is stored per partner, and everyone already invited keeps
  // the number their agreement states. Do not back-fill it — that would be
  // rewriting a signed commercial term after the fact.
  //
  // The public /referrals page quotes this figure. Change both together.
  const { userId, commissionRate = 0.15, companyName = null, notes = null } = params
  const code = await ensureReferralCode(userId)

  await db.partner.upsert({
    where: { userId },
    // Re-inviting someone who already accepted must not silently reset them to
    // `invited` and pull their account out from under them, so status is left
    // alone on update — use the admin status route to change it deliberately.
    update: { commissionRate, companyName, notes, endedAt: null },
    create: { userId, commissionRate, companyName, notes, status: 'invited' },
  })
  return { code }
}

/**
 * The partner accepted the agreement. This is the moment they become active:
 * commission starts accruing and the comped Pro account switches on.
 *
 * The version and IP are recorded because "what exactly did they agree to" is
 * the only question that matters if this is ever disputed, and "the current
 * contents of a file in our repo" is not an answer.
 */
export async function acceptAgreement(userId: number, ip: string | null): Promise<boolean> {
  const partner = await db.partner.findUnique({ where: { userId }, select: { status: true } })
  if (!partner) return false
  // Only an invitation can be accepted. Re-posting must not resurrect someone
  // who was suspended or whose partnership has ended.
  if (partner.status !== 'invited') return partner.status === 'active'

  await db.partner.update({
    where: { userId },
    data: {
      status: 'active',
      agreementSignedAt: new Date(),
      agreementVersion: PARTNER_AGREEMENT_VERSION,
      agreementIp: ip,
      startedAt: new Date(),
    },
  })
  return true
}

/**
 * End a partnership. Their comped access stops, but the commission already on
 * the ledger is untouched: section 7 of the agreement promises trailing
 * commission on customers referred before it ended, and a statement that
 * silently loses lines is the fastest way to a dispute.
 */
export async function endPartner(userId: number): Promise<void> {
  await db.partner.updateMany({
    where: { userId },
    data: { status: 'ended', endedAt: new Date() },
  })
}

/**
 * Record commission on a payment that has actually cleared.
 *
 * Keyed on the Stripe invoice id, so a retried webhook cannot pay twice — and
 * the rate is copied onto the row rather than read from the partner, because a
 * rate change must apply to future referrals only (agreement, section 7).
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

  const partner = await db.partner.findUnique({
    where: { userId: referral.referrerId },
    select: { id: true, status: true, commissionRate: true },
  })
  // Ended partners keep earning on customers they already referred; suspended
  // ones do not. Only `ended` is in the trailing-commission promise — and
  // `invited` has not agreed to anything yet, so nothing is owed to them.
  if (!partner || partner.status === 'suspended' || partner.status === 'invited') return

  // The 12-month window runs from the customer's first payment, not from today.
  const start = referral.qualifiedAt ?? referral.createdAt
  const windowEnds = new Date(start)
  windowEnds.setMonth(windowEnds.getMonth() + COMMISSION_WINDOW_MONTHS)
  if (new Date() > windowEnds) return

  const rate = Number(partner.commissionRate)
  const commissionAmount = Math.round(netAmount * rate)

  try {
    await db.partnerCommission.create({
      data: {
        partnerId: partner.id,
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

/** Reverse a statement line after a refund or chargeback (agreement, section 5). */
export async function reverseCommission(providerInvoiceId: string): Promise<void> {
  await db.partnerCommission.updateMany({
    where: { providerInvoiceId, reversedAt: null },
    data: { reversedAt: new Date() },
  })
}

/** Balance below which commission rolls over instead of being paid (£50). */
export const PAYOUT_THRESHOLD_PENCE = 5000

export interface PartnerStatement {
  status: string
  /** True while they have been invited but have not accepted the agreement. */
  awaitingAgreement: boolean
  agreementVersion: string | null
  agreementSignedAt: Date | null
  code: string
  commissionRate: number
  companyName: string | null
  startedAt: Date
  endedAt: Date | null
  currency: string
  /** Earned, not reversed, not yet paid out. */
  balancePence: number
  lifetimePence: number
  payoutThresholdPence: number
  payable: boolean
  customers: { firstName: string; joinedAt: Date; status: string }[]
  lines: {
    customerFirstName: string
    netAmount: number
    commissionAmount: number
    currency: string
    createdAt: Date
    reversedAt: Date | null
    paidOutAt: Date | null
  }[]
}

export async function getPartnerStatement(userId: number): Promise<PartnerStatement | null> {
  const partner = await db.partner.findUnique({
    where: { userId },
    select: {
      id: true,
      status: true,
      commissionRate: true,
      companyName: true,
      startedAt: true,
      endedAt: true,
      agreementVersion: true,
      agreementSignedAt: true,
    },
  })
  if (!partner) return null

  const [code, lines, referrals] = await Promise.all([
    ensureReferralCode(userId),
    db.partnerCommission.findMany({
      where: { partnerId: partner.id },
      orderBy: { createdAt: 'desc' },
      select: {
        netAmount: true,
        commissionAmount: true,
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
    status: partner.status,
    awaitingAgreement: partner.status === 'invited',
    agreementVersion: partner.agreementVersion,
    agreementSignedAt: partner.agreementSignedAt,
    code,
    commissionRate: Number(partner.commissionRate),
    companyName: partner.companyName,
    startedAt: partner.startedAt,
    endedAt: partner.endedAt,
    currency: live[0]?.currency ?? 'GBP',
    balancePence,
    lifetimePence: live.reduce((s, l) => s + l.commissionAmount, 0),
    payoutThresholdPence: PAYOUT_THRESHOLD_PENCE,
    payable: balancePence >= PAYOUT_THRESHOLD_PENCE,
    customers: referrals.map((r) => ({
      firstName: r.referred.name,
      joinedAt: r.createdAt,
      status: r.status,
    })),
    lines: lines.map((l) => ({
      customerFirstName: l.customer.name,
      netAmount: l.netAmount,
      commissionAmount: l.commissionAmount,
      currency: l.currency,
      createdAt: l.createdAt,
      reversedAt: l.reversedAt,
      paidOutAt: l.paidOutAt,
    })),
  }
}
