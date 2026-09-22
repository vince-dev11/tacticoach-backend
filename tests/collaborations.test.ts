// Collaboration commission: who earns, how much, and the cases where a naive
// implementation pays out money it shouldn't.
//
// The thing that changed and needs the most defending is that there are now
// TWO rates — 15% for an individual coach, 20% for a club — and which applies
// is resolved from the plan each payment is FOR, not fixed when the customer
// first paid. That means a coach who upgrades to a club plan moves their
// collaborator up from that invoice onward, which is the behaviour the whole
// split exists to produce.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import {
  recordCommission,
  reverseCommission,
  acceptAgreement,
  inviteCollaborator,
  rateForPlan,
  DEFAULT_COACH_RATE,
  DEFAULT_CLUB_RATE,
  PAYOUT_THRESHOLD_PENCE,
  CONTENT_PER_CYCLE,
  CONTENT_VIDEO_MINIMUM,
  nextPayoutDate,
} from '../src/modules/collaborations/collaborations.service.js'
import {
  COLLABORATION_AGREEMENT,
  COLLABORATION_AGREEMENT_VERSION,
} from '../src/modules/collaborations/collaboration-agreement.js'
import { getEntitlements } from '../src/lib/entitlements.js'
import { can } from '../src/lib/capabilities.js'
import { activeSubscription } from './helpers.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const monthsAgo = (n: number) => {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d
}

beforeEach(() => {
  mock.collaboratorCommission.create.mockResolvedValue({} as never)
  mock.collaboratorCommission.updateMany.mockResolvedValue({ count: 1 } as never)
  // The customer is on Pro unless a test says otherwise — recordCommission
  // reads this to decide which of the two rates applies.
  onPlan('pro')
})

/** What the CUSTOMER is paying for, which picks the rate. */
function onPlan(slug: string | null) {
  mock.userSubscription.findUnique.mockResolvedValue(
    (slug ? { plan: { slug } } : null) as never,
  )
}

function referredBy(collaboratorUserId: number, qualifiedAt: Date, status = 'qualified') {
  mock.referral.findUnique.mockResolvedValue({
    referrerId: collaboratorUserId,
    status,
    qualifiedAt,
    createdAt: qualifiedAt,
  } as never)
}

function collaboratorRow(overrides: Record<string, unknown> = {}) {
  mock.collaborator.findUnique.mockResolvedValue({
    id: 3,
    status: 'active',
    coachRate: DEFAULT_COACH_RATE,
    clubRate: DEFAULT_CLUB_RATE,
    ...overrides,
  } as never)
}

const writtenLine = () =>
  (mock.collaboratorCommission.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })?.data

describe('which rate applies', () => {
  it('pays the coach rate for an individual coach', () => {
    expect(rateForPlan('pro', { coachRate: 0.15, clubRate: 0.2 })).toBe(0.15)
    expect(rateForPlan('basic', { coachRate: 0.15, clubRate: 0.2 })).toBe(0.15)
  })

  it('pays the club rate for every club plan', () => {
    for (const slug of ['club', 'club-5', 'club-10', 'club-20']) {
      expect(rateForPlan(slug, { coachRate: 0.15, clubRate: 0.2 }), slug).toBe(0.2)
    }
  })

  it('falls to the coach rate for a plan it cannot place', () => {
    // An unknown slug must not be silently promoted to the dearer rate.
    expect(rateForPlan('enterprise-mega', { coachRate: 0.15, clubRate: 0.2 })).toBe(0.15)
    expect(rateForPlan(null, { coachRate: 0.15, clubRate: 0.2 })).toBe(0.15)
  })

  it('pays more for a club than for a coach, by default', () => {
    // The whole point of the split. If these are ever equal, the club rate has
    // been edited to nothing and every collaborator rationally chases the easy
    // sale instead.
    expect(DEFAULT_CLUB_RATE).toBeGreaterThan(DEFAULT_COACH_RATE)
  })

  it('states both rates as FRACTIONS, not percents', () => {
    // The admin route caps a rate at 1, so `15` meaning 15% would be refused
    // rather than committing us to fifteen times the revenue. This is the
    // guard on the constants themselves.
    expect(DEFAULT_COACH_RATE).toBeLessThan(1)
    expect(DEFAULT_CLUB_RATE).toBeLessThan(1)
    expect(DEFAULT_COACH_RATE).toBeGreaterThan(0)
  })
})

describe('recordCommission', () => {
  it('takes the coach rate off the net amount for a coach', async () => {
    referredBy(7, monthsAgo(1))
    collaboratorRow()
    onPlan('pro')

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_1', netAmount: 7900, currency: 'gbp' })

    expect(writtenLine()).toMatchObject({
      collaboratorId: 3,
      customerId: 99,
      netAmount: 7900,
      rate: DEFAULT_COACH_RATE,
      commissionAmount: Math.round(7900 * DEFAULT_COACH_RATE),
      currency: 'GBP',
    })
  })

  it('takes the CLUB rate off a club payment', async () => {
    referredBy(7, monthsAgo(1))
    collaboratorRow()
    onPlan('club-10')

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_2', netAmount: 40000, currency: 'gbp' })

    expect(writtenLine()).toMatchObject({
      rate: DEFAULT_CLUB_RATE,
      commissionAmount: Math.round(40000 * DEFAULT_CLUB_RATE),
    })
  })

  it('moves to the club rate when a coach upgrades, from that payment onward', async () => {
    // The behaviour the split exists to produce: the collaborator has a reason
    // to help a coach grow into a club, which is the most valuable thing they
    // could do for us. Locking the rate at the first payment would pay them
    // LESS for the better outcome.
    referredBy(7, monthsAgo(6))
    collaboratorRow()

    onPlan('pro')
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_early', netAmount: 899, currency: 'gbp' })
    const early = writtenLine()

    mock.collaboratorCommission.create.mockClear()
    onPlan('club-20')
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_later', netAmount: 6999, currency: 'gbp' })
    const later = writtenLine()

    expect(early.rate).toBe(DEFAULT_COACH_RATE)
    expect(later.rate).toBe(DEFAULT_CLUB_RATE)
  })

  it('copies the rate onto the line so a later rate change cannot restate history', async () => {
    referredBy(7, monthsAgo(1))
    collaboratorRow({ coachRate: 0.35, clubRate: 0.4 })
    onPlan('pro')

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_3', netAmount: 1000, currency: 'gbp' })

    expect(writtenLine().rate).toBe(0.35)
    expect(writtenLine().commissionAmount).toBe(350)
  })

  it('pays nothing when the customer was not referred by anyone', async () => {
    mock.referral.findUnique.mockResolvedValue(null as never)
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_4', netAmount: 1000, currency: 'gbp' })
    expect(mock.collaboratorCommission.create).not.toHaveBeenCalled()
  })

  it('pays nothing when the referrer is on the credit programme, not this one', async () => {
    referredBy(7, monthsAgo(1))
    mock.collaborator.findUnique.mockResolvedValue(null as never)
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_5', netAmount: 1000, currency: 'gbp' })
    expect(mock.collaboratorCommission.create).not.toHaveBeenCalled()
  })

  it('keeps paying an ENDED collaborator — trailing commission is promised', async () => {
    referredBy(7, monthsAgo(1))
    collaboratorRow({ status: 'ended' })
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_6', netAmount: 1000, currency: 'gbp' })
    expect(mock.collaboratorCommission.create).toHaveBeenCalled()
  })

  it('pays nothing to somebody who has not accepted the agreement yet', async () => {
    referredBy(7, monthsAgo(1))
    collaboratorRow({ status: 'invited' })
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_7', netAmount: 1000, currency: 'gbp' })
    expect(mock.collaboratorCommission.create).not.toHaveBeenCalled()
  })

  it('stops paying a SUSPENDED collaborator', async () => {
    referredBy(7, monthsAgo(1))
    collaboratorRow({ status: 'suspended' })
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_8', netAmount: 1000, currency: 'gbp' })
    expect(mock.collaboratorCommission.create).not.toHaveBeenCalled()
  })

  it('stops after the 12-month window, counted from the first payment', async () => {
    referredBy(7, monthsAgo(13))
    collaboratorRow()
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_9', netAmount: 1000, currency: 'gbp' })
    expect(mock.collaboratorCommission.create).not.toHaveBeenCalled()
  })

  it('still pays inside the window', async () => {
    referredBy(7, monthsAgo(11))
    collaboratorRow()
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_10', netAmount: 1000, currency: 'gbp' })
    expect(mock.collaboratorCommission.create).toHaveBeenCalled()
  })

  it('pays nothing on a reversed referral', async () => {
    referredBy(7, monthsAgo(1), 'reversed')
    collaboratorRow()
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_11', netAmount: 1000, currency: 'gbp' })
    expect(mock.collaboratorCommission.create).not.toHaveBeenCalled()
  })

  it('ignores a zero or negative invoice', async () => {
    referredBy(7, monthsAgo(1))
    collaboratorRow()
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_12', netAmount: 0, currency: 'gbp' })
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_13', netAmount: -500, currency: 'gbp' })
    expect(mock.collaboratorCommission.create).not.toHaveBeenCalled()
  })

  it('does not pay twice for the same invoice', async () => {
    referredBy(7, monthsAgo(1))
    collaboratorRow()
    mock.collaboratorCommission.create.mockRejectedValue(new Error('Unique constraint failed'))
    await expect(
      recordCommission({ customerId: 99, providerInvoiceId: 'in_14', netAmount: 1000, currency: 'gbp' }),
    ).resolves.toBeUndefined()
  })

  it('pays the coach rate when the customer has no subscription row to read', async () => {
    // Belt and braces: a payment that arrives before the subscription row is
    // written must not throw, and must not default to the dearer rate.
    referredBy(7, monthsAgo(1))
    collaboratorRow()
    onPlan(null)
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_15', netAmount: 1000, currency: 'gbp' })
    expect(writtenLine().rate).toBe(DEFAULT_COACH_RATE)
  })
})

describe('reverseCommission', () => {
  it('reverses rather than deletes, so the statement still explains itself', async () => {
    await reverseCommission('in_1')
    expect(mock.collaboratorCommission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerInvoiceId: 'in_1', reversedAt: null },
        data: { reversedAt: expect.any(Date) },
      }),
    )
  })
})

describe('accepting the agreement', () => {
  it('activates them and records what they accepted', async () => {
    mock.collaborator.findUnique.mockResolvedValue({ status: 'invited' } as never)
    mock.collaborator.update.mockResolvedValue({} as never)

    expect(await acceptAgreement(7, '1.2.3.4')).toBe(true)
    expect(mock.collaborator.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'active',
          agreementVersion: COLLABORATION_AGREEMENT_VERSION,
          agreementIp: '1.2.3.4',
        }),
      }),
    )
  })

  it('is idempotent for somebody already active', async () => {
    mock.collaborator.findUnique.mockResolvedValue({ status: 'active' } as never)
    expect(await acceptAgreement(7, null)).toBe(true)
    expect(mock.collaborator.update).not.toHaveBeenCalled()
  })

  it('cannot resurrect an ended or suspended collaboration', async () => {
    for (const status of ['ended', 'suspended']) {
      mock.collaborator.findUnique.mockResolvedValue({ status } as never)
      expect(await acceptAgreement(7, null), status).toBe(false)
      expect(mock.collaborator.update).not.toHaveBeenCalled()
    }
  })

  it('refuses somebody who was never invited', async () => {
    mock.collaborator.findUnique.mockResolvedValue(null as never)
    expect(await acceptAgreement(7, null)).toBe(false)
  })
})

describe('inviting', () => {
  beforeEach(() => {
    mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'SAM-4K2XQ', name: 'Sam' } as never)
    mock.collaborator.upsert.mockResolvedValue({} as never)
  })

  it('invites at the default rates when none are given', async () => {
    await inviteCollaborator({ userId: 7 })
    const args = mock.collaborator.upsert.mock.calls[0][0] as { create: Record<string, unknown> }
    expect(args.create).toMatchObject({
      coachRate: DEFAULT_COACH_RATE,
      clubRate: DEFAULT_CLUB_RATE,
      status: 'invited',
    })
  })

  it('still honours rates that were passed explicitly', async () => {
    await inviteCollaborator({ userId: 7, coachRate: 0.25, clubRate: 0.3 })
    const args = mock.collaborator.upsert.mock.calls[0][0] as { create: Record<string, unknown> }
    expect(args.create).toMatchObject({ coachRate: 0.25, clubRate: 0.3 })
  })

  it('does not reset an existing collaborator to `invited` when re-invited', async () => {
    // Re-inviting somebody who already accepted must not pull their comped
    // account out from under them.
    await inviteCollaborator({ userId: 7 })
    const args = mock.collaborator.upsert.mock.calls[0][0] as { update: Record<string, unknown> }
    expect(args.update).not.toHaveProperty('status')
  })

  it('reuses their existing referral code', async () => {
    // A link already on their slides must keep working the day they sign.
    const { code } = await inviteCollaborator({ userId: 7 })
    expect(code).toBe('SAM-4K2XQ')
  })
})

describe('when they get paid', () => {
  it('pays on the first of February, June and October', () => {
    expect(nextPayoutDate(new Date('2026-01-15T00:00:00Z')).toISOString()).toContain('2026-02-01')
    expect(nextPayoutDate(new Date('2026-03-01T00:00:00Z')).toISOString()).toContain('2026-06-01')
    expect(nextPayoutDate(new Date('2026-07-04T00:00:00Z')).toISOString()).toContain('2026-10-01')
  })

  it('rolls into next year past the last payout', () => {
    expect(nextPayoutDate(new Date('2026-11-20T00:00:00Z')).toISOString()).toContain('2027-02-01')
  })

  it('treats a payout date itself as due, not passed', () => {
    // Off-by-one on the boundary would silently skip a whole cycle.
    expect(nextPayoutDate(new Date('2026-06-01T00:00:00Z')).toISOString()).toContain('2026-06-01')
  })

  it('always returns a date in the future or today, from any day of the year', () => {
    for (let day = 0; day < 365; day += 7) {
      const from = new Date(Date.UTC(2026, 0, 1 + day))
      expect(nextPayoutDate(from).getTime(), from.toISOString()).toBeGreaterThanOrEqual(from.getTime())
    }
  })
})

describe('the agreement text', () => {
  const text = [
    ...COLLABORATION_AGREEMENT.intro,
    ...COLLABORATION_AGREEMENT.sections.flatMap((s) => [...(s.body ?? []), ...(s.points ?? [])]),
  ].join(' ')

  it('is versioned, so a later edit cannot rewrite what somebody accepted', () => {
    expect(COLLABORATION_AGREEMENT.version).toBe(COLLABORATION_AGREEMENT_VERSION)
    expect(COLLABORATION_AGREEMENT_VERSION).toMatch(/^\d+\.\d+$/)
  })

  it('numbers its sections in order with no gaps', () => {
    const numbers = COLLABORATION_AGREEMENT.sections.map((s) => Number(s.heading.split('.')[0]))
    expect(numbers).toEqual(numbers.map((_, i) => i + 1))
  })

  it('quotes BOTH rates, and no other percentage', () => {
    // The old partner agreement promised 20% while the system paid 15%,
    // because the figure was typed in one place and stored in another. Every
    // figure here is interpolated from the constants, and this is what stops
    // a new hand-typed one creeping in.
    const percentages = text.match(/\d+(?:\.\d+)?%/g) ?? []
    expect(percentages.length).toBeGreaterThan(0)
    expect(new Set(percentages)).toEqual(
      new Set([`${Math.round(DEFAULT_COACH_RATE * 100)}%`, `${Math.round(DEFAULT_CLUB_RATE * 100)}%`]),
    )
  })

  it('would notice a hand-typed percentage', () => {
    // Mutation check on the guard above.
    const tampered = `${text} and a bonus 30% for the first month`
    const percentages = tampered.match(/\d+(?:\.\d+)?%/g) ?? []
    expect(new Set(percentages).size).toBeGreaterThan(2)
  })

  it('quotes the payout threshold the code actually enforces', () => {
    expect(text).toContain(`£${(PAYOUT_THRESHOLD_PENCE / 100).toFixed(0)}`)
  })

  it('states the content expectation, including the video minimum', () => {
    expect(text).toContain(`${CONTENT_PER_CYCLE} pieces of content`)
    expect(text).toContain(`at least ${CONTENT_VIDEO_MINIMUM}`)
    expect(text.toLowerCase()).toContain('video or reel')
  })

  it('says plainly that missing it does NOT withhold money', () => {
    // The distinction the whole design rests on. If this sentence ever leaves
    // the document, the programme has quietly become a job.
    const missing = COLLABORATION_AGREEMENT.sections.find((s) => /do not post/i.test(s.heading))
    expect(missing, 'no section about missing the expectation').toBeTruthy()
    expect(missing!.body!.join(' ')).toMatch(/nothing is withheld/i)
  })

  it('names the payout dates', () => {
    expect(text).toMatch(/1 February, 1 June and 1 October/)
  })

  it('promises the comped account that entitlements actually grant', () => {
    expect(text).toMatch(/Pro account at no charge/i)
  })

  it('protects children in the listing clause, without hedging', () => {
    const listing = COLLABORATION_AGREEMENT.sections.find((s) => /listed/i.test(s.heading))
    expect(listing).toBeTruthy()
    expect(listing!.points!.join(' ')).toMatch(/nothing about players/i)
  })

  it('forbids self-dealing', () => {
    expect(text).toMatch(/No commission on yourself/i)
  })

  it('does not promise anything the product cannot deliver', () => {
    // A clause nobody implemented is worse than no clause.
    expect(text).not.toMatch(/first month free/i)
    expect(text).not.toMatch(/dedicated account manager/i)
    expect(text).not.toMatch(/monthly payout/i)
  })

  it('does not call it a partnership', () => {
    // The word the rename exists to remove: in England and Wales a
    // partnership is a legal entity with joint liability. The only permitted
    // use is the sentence denying one.
    const uses = text.match(/partnership/gi) ?? []
    for (const _ of uses) expect(text).toMatch(/not a legal partnership/i)
    expect(text).not.toMatch(/\bPartner Programme\b/)
  })
})

describe('a collaborator’s own access', () => {
  function userOn(collaboratorStatus: string | null, subscription: unknown = null) {
    mock.user.findUnique.mockResolvedValue({ id: 7, accountType: 'coach' } as never)
    mock.userSubscription.findUnique.mockResolvedValue(subscription as never)
    mock.collaborator.findUnique.mockResolvedValue(
      (collaboratorStatus ? { status: collaboratorStatus } : null) as never,
    )
    mock.clubMember.findUnique.mockResolvedValue(null as never)
    mock.club.findUnique.mockResolvedValue(null as never)
    mock.squadPlayer.findFirst.mockResolvedValue(null as never)
    // The comped plan entitlements looks up when the collaboration is what
    // grants access. Without it `collaborationPlan` is null and the coach
    // silently lands on the free tier — which is the bug this whole block is
    // here to catch, so the fixture has to make the happy path possible.
    mock.membershipPlan.findUnique.mockResolvedValue(
      { id: 2, name: 'Pro', slug: 'pro' } as never,
    )
  }

  it('opens the editor without a subscription', async () => {
    userOn('active')
    const ent = await getEntitlements(7)
    expect(can(ent, 'editor')).toBe(true)
    expect(ent.viaCollaboration).toBe(true)
  })

  it('gives no Pro to somebody invited who has not accepted', async () => {
    userOn('invited')
    const ent = await getEntitlements(7)
    expect(ent.viaCollaboration).toBe(false)
  })

  it('takes Pro back once the collaboration ends', async () => {
    userOn('ended')
    const ent = await getEntitlements(7)
    expect(ent.viaCollaboration).toBe(false)
  })

  it('takes it back while suspended', async () => {
    userOn('suspended')
    const ent = await getEntitlements(7)
    expect(ent.viaCollaboration).toBe(false)
  })

  it('does not downgrade a collaborator who also pays for Club', async () => {
    // Signing this must never silently move somebody from Club to Pro.
    userOn('active', activeSubscription({ plan: { id: 5, name: 'Club 10', slug: 'club-10' } }))
    const ent = await getEntitlements(7)
    expect(ent.viaCollaboration).toBe(false)
    expect(ent.plan.slug).toBe('club-10')
  })
})
