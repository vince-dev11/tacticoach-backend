// Partner commission: who earns, how much, and the cases where a naive
// implementation pays out money it shouldn't.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import {
  recordCommission,
  reverseCommission,
  acceptAgreement,
  invitePartner,
} from '../src/modules/partners/partners.service.js'
import { PARTNER_AGREEMENT, PARTNER_AGREEMENT_VERSION } from '../src/modules/partners/partner-agreement.js'
import { getEntitlements } from '../src/lib/entitlements.js'
import { activeSubscription } from './helpers.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const monthsAgo = (n: number) => {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d
}

beforeEach(() => {
  mock.partnerCommission.create.mockResolvedValue({} as never)
  mock.partnerCommission.updateMany.mockResolvedValue({ count: 1 } as never)
})

function referredBy(partnerUserId: number, qualifiedAt: Date, status = 'qualified') {
  mock.referral.findUnique.mockResolvedValue({
    referrerId: partnerUserId,
    status,
    qualifiedAt,
    createdAt: qualifiedAt,
  } as never)
}

function partnerRow(overrides: Record<string, unknown> = {}) {
  mock.partner.findUnique.mockResolvedValue({
    id: 3,
    status: 'active',
    commissionRate: 0.2,
    ...overrides,
  } as never)
}

describe('recordCommission', () => {
  it('takes the partner rate off the net amount', async () => {
    referredBy(7, monthsAgo(1))
    partnerRow()

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_1', netAmount: 2499, currency: 'gbp' })

    expect(mock.partnerCommission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          partnerId: 3,
          customerId: 99,
          netAmount: 2499,
          commissionAmount: 500, // 20% of £24.99, rounded to the penny
          currency: 'GBP',
          rate: 0.2,
        }),
      }),
    )
  })

  it('copies the rate onto the line so a later rate change cannot restate history', async () => {
    referredBy(7, monthsAgo(1))
    partnerRow({ commissionRate: 0.35 })

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_2', netAmount: 1000, currency: 'gbp' })

    const data = mock.partnerCommission.create.mock.calls[0][0] as { data: { rate: number } }
    expect(data.data.rate).toBe(0.35)
  })

  it('pays nothing when the customer was not referred by anyone', async () => {
    mock.referral.findUnique.mockResolvedValue(null as never)

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_3', netAmount: 2499, currency: 'gbp' })
    expect(mock.partnerCommission.create).not.toHaveBeenCalled()
  })

  it('pays nothing when the referrer is on the credit programme, not the partner one', async () => {
    referredBy(7, monthsAgo(1))
    mock.partner.findUnique.mockResolvedValue(null as never)

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_4', netAmount: 2499, currency: 'gbp' })
    expect(mock.partnerCommission.create).not.toHaveBeenCalled()
  })

  it('keeps paying an ENDED partner — trailing commission is promised in §7', async () => {
    referredBy(7, monthsAgo(2))
    partnerRow({ status: 'ended' })

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_5', netAmount: 2499, currency: 'gbp' })
    expect(mock.partnerCommission.create).toHaveBeenCalled()
  })

  it('pays nothing to a partner who has not accepted the agreement yet', async () => {
    // `invited` means we asked and they have not answered. Paying commission to
    // someone who has agreed to nothing is the worst of both worlds.
    referredBy(7, monthsAgo(1))
    partnerRow({ status: 'invited' })

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_12', netAmount: 2499, currency: 'gbp' })
    expect(mock.partnerCommission.create).not.toHaveBeenCalled()
  })

  it('stops paying a SUSPENDED partner', async () => {
    referredBy(7, monthsAgo(2))
    partnerRow({ status: 'suspended' })

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_6', netAmount: 2499, currency: 'gbp' })
    expect(mock.partnerCommission.create).not.toHaveBeenCalled()
  })

  it('stops after the 12-month window, counted from the first payment', async () => {
    referredBy(7, monthsAgo(13))
    partnerRow()

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_7', netAmount: 2499, currency: 'gbp' })
    expect(mock.partnerCommission.create).not.toHaveBeenCalled()
  })

  it('still pays inside the window', async () => {
    referredBy(7, monthsAgo(11))
    partnerRow()

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_8', netAmount: 2499, currency: 'gbp' })
    expect(mock.partnerCommission.create).toHaveBeenCalled()
  })

  it('pays nothing on a reversed referral', async () => {
    referredBy(7, monthsAgo(1), 'reversed')
    partnerRow()

    await recordCommission({ customerId: 99, providerInvoiceId: 'in_9', netAmount: 2499, currency: 'gbp' })
    expect(mock.partnerCommission.create).not.toHaveBeenCalled()
  })

  it('ignores a zero or negative invoice', async () => {
    referredBy(7, monthsAgo(1))
    partnerRow()

    // A £0 invoice is what a fully credit-covered month looks like. Paying 20%
    // of nothing is harmless; paying 20% of a refund line would not be.
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_10', netAmount: 0, currency: 'gbp' })
    await recordCommission({ customerId: 99, providerInvoiceId: 'in_11', netAmount: -500, currency: 'gbp' })
    expect(mock.partnerCommission.create).not.toHaveBeenCalled()
  })

  it('does not pay twice for the same invoice', async () => {
    referredBy(7, monthsAgo(1))
    partnerRow()
    mock.partnerCommission.create.mockRejectedValue(new Error('Unique constraint failed'))

    // Stripe retries webhooks; the unique key on the invoice id is the guard
    // and the service must not turn it into a 500.
    await expect(
      recordCommission({ customerId: 99, providerInvoiceId: 'in_1', netAmount: 2499, currency: 'gbp' }),
    ).resolves.toBeUndefined()
  })
})

describe('reverseCommission', () => {
  it('reverses rather than deletes, so the statement still explains itself', async () => {
    await reverseCommission('in_1')

    expect(mock.partnerCommission.updateMany).toHaveBeenCalledWith({
      where: { providerInvoiceId: 'in_1', reversedAt: null },
      data: { reversedAt: expect.any(Date) },
    })
  })
})

describe('accepting the agreement', () => {
  it('activates them and records what they accepted', async () => {
    mock.partner.findUnique.mockResolvedValue({ status: 'invited' } as never)
    mock.partner.update.mockResolvedValue({} as never)

    expect(await acceptAgreement(7, '203.0.113.9')).toBe(true)
    expect(mock.partner.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'active',
          agreementVersion: PARTNER_AGREEMENT_VERSION,
          agreementIp: '203.0.113.9',
          agreementSignedAt: expect.any(Date),
        }),
      }),
    )
  })

  it('is idempotent for someone already active', async () => {
    mock.partner.findUnique.mockResolvedValue({ status: 'active' } as never)

    expect(await acceptAgreement(7, null)).toBe(true)
    expect(mock.partner.update).not.toHaveBeenCalled()
  })

  it('cannot resurrect an ended or suspended partnership', async () => {
    // Otherwise anyone we removed could re-activate themselves — and restore
    // their own comped account — by replaying one POST.
    for (const status of ['ended', 'suspended']) {
      mock.partner.update.mockClear()
      mock.partner.findUnique.mockResolvedValue({ status } as never)

      expect(await acceptAgreement(7, null)).toBe(false)
      expect(mock.partner.update).not.toHaveBeenCalled()
    }
  })

  it('refuses someone who was never invited', async () => {
    mock.partner.findUnique.mockResolvedValue(null as never)

    expect(await acceptAgreement(7, null)).toBe(false)
    expect(mock.partner.update).not.toHaveBeenCalled()
  })
})

describe('the agreement text', () => {
  it('is versioned, so a later edit cannot rewrite what someone accepted', () => {
    expect(PARTNER_AGREEMENT.version).toBe(PARTNER_AGREEMENT_VERSION)
    expect(PARTNER_AGREEMENT_VERSION).toMatch(/^\d+\.\d+$/)
  })

  it('numbers its sections in order with no gaps', () => {
    const numbers = PARTNER_AGREEMENT.sections.map((s) => Number(s.heading.split('.')[0]))
    expect(numbers).toEqual(numbers.map((_, i) => i + 1))
  })

  it('states the content expectation the programme is built around', () => {
    const posting = PARTNER_AGREEMENT.sections.find((s) => /Posting about/i.test(s.heading))
    expect(posting).toBeTruthy()
    expect(posting!.body!.join(' ')).toMatch(/twice a month/i)
  })

  it('promises the comped account that entitlements actually grant', () => {
    // These two drift apart easily: the clause says Pro, the code grants Pro.
    // If either changes alone, a partner is promised something they do not get.
    const account = PARTNER_AGREEMENT.sections.find((s) => /Your TactiCoach account/i.test(s.heading))
    expect(account!.body!.join(' ')).toMatch(/Pro account at no charge/i)
  })

  it('does not promise anything the product cannot deliver', () => {
    // The old Word agreement promised referred coaches a free first month. That
    // is not built, so it must not appear in a contract anyone signs.
    const all = JSON.stringify(PARTNER_AGREEMENT).toLowerCase()
    expect(all).not.toMatch(/first month free/)
    // Pro + AI is feature-flagged off and seeded inactive.
    expect(all).not.toMatch(/pro \+ ai/)
  })
})

describe('a partner’s own access', () => {
  function noSubscription() {
    mock.user.findUnique.mockResolvedValue({ role: 'user' } as never)
    mock.userSubscription.findUnique.mockResolvedValue(null as never)
    mock.clubMember.findUnique.mockResolvedValue(null as never)
    mock.club.findUnique.mockResolvedValue(null as never)
  }

  it('opens the editor without a subscription', async () => {
    noSubscription()
    mock.partner.findUnique.mockResolvedValue({ status: 'active' } as never)
    mock.membershipPlan.findUnique.mockResolvedValue({ id: 2, name: 'Pro', slug: 'pro' } as never)

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(true)
    expect(ent.viaPartner).toBe(true)
    expect(ent.plan?.slug).toBe('pro')
    // They are not a customer — nothing is pretending they bought anything.
    expect(ent.subscriptionStatus).toBeNull()
  })

  it('does not downgrade a partner who also pays for Club', async () => {
    mock.user.findUnique.mockResolvedValue({ role: 'user' } as never)
    mock.userSubscription.findUnique.mockResolvedValue(
      activeSubscription({ plan: { id: 3, name: 'Club', slug: 'club' } }) as never,
    )
    mock.clubMember.findUnique.mockResolvedValue(null as never)
    mock.club.findUnique.mockResolvedValue({ id: 4 } as never)
    mock.partner.findUnique.mockResolvedValue({ status: 'active' } as never)

    const ent = await getEntitlements(1)
    expect(ent.plan?.slug).toBe('club')
    expect(ent.viaPartner).toBe(false)
    expect(ent.isClubOwner).toBe(true)
  })

  it('gives nothing to an invited partner who has not accepted', async () => {
    noSubscription()
    mock.partner.findUnique.mockResolvedValue({ status: 'invited' } as never)

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(false)
    expect(ent.viaPartner).toBe(false)
  })

  it('closes the editor once the partnership ends', async () => {
    noSubscription()
    mock.partner.findUnique.mockResolvedValue({ status: 'ended' } as never)

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(false)
    expect(ent.viaPartner).toBe(false)
  })

  it('closes it while suspended', async () => {
    noSubscription()
    mock.partner.findUnique.mockResolvedValue({ status: 'suspended' } as never)

    const ent = await getEntitlements(1)
    expect(ent.editorAccess).toBe(false)
  })
})

describe('the default commission rate', () => {
  // 15% since 2026-09-17, down from 20%. Three things have to agree or we
  // advertise one number and pay another: this default, the DB column default
  // (migration 25) and the public /referrals page.
  beforeEach(() => {
    mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'ABC123', name: 'Ana' } as never)
    mock.partner.upsert.mockResolvedValue({ id: 3 } as never)
  })

  it('invites at 15% when no rate is given', async () => {
    await invitePartner({ userId: 7 })
    const args = mock.partner.upsert.mock.calls[0][0] as {
      create: { commissionRate: number }
    }
    expect(args.create.commissionRate).toBe(0.15)
  })

  it('is a FRACTION, not a percent', async () => {
    // The whole class of bug this guards: 15 instead of 0.15 would mean
    // fifteen times the revenue paid out per referral. The route caps at 1,
    // but the default must never be the thing that breaches it.
    await invitePartner({ userId: 7 })
    const args = mock.partner.upsert.mock.calls[0][0] as {
      create: { commissionRate: number }
    }
    expect(args.create.commissionRate).toBeLessThanOrEqual(1)
  })

  it('still honours a rate that was passed explicitly', async () => {
    await invitePartner({ userId: 7, commissionRate: 0.25 })
    const args = mock.partner.upsert.mock.calls[0][0] as {
      create: { commissionRate: number }
    }
    expect(args.create.commissionRate).toBe(0.25)
  })

  it('does not reset an existing partner to `invited` when re-invited', async () => {
    // Re-inviting someone who already signed must not pull their active
    // account out from under them — the update branch deliberately omits
    // status.
    await invitePartner({ userId: 7 })
    const args = mock.partner.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>
    }
    expect(args.update).not.toHaveProperty('status')
  })
})
