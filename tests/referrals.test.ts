// Referral attribution, qualification and payout.
//
// These use the deep Prisma mock, so they check the DECISIONS the service makes
// — who gets credited, when, and how many times — rather than SQL.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import {
  attachReferral,
  qualifyReferral,
  reverseReferral,
  syncRewards,
  ensureReferralCode,
} from '../src/modules/referrals/referrals.service.js'

// `db.partner` / `db.referral` are only typed once `prisma generate` has run
// against the new schema. The mock creates them at runtime regardless, so the
// tests are honest; this just keeps tsc quiet before a fresh generate.
const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

function noRewards() {
  mock.referralReward.findMany.mockResolvedValue([] as never)
  mock.referralReward.create.mockResolvedValue({} as never)
  mock.referralReward.updateMany.mockResolvedValue({ count: 0 } as never)
  mock.user.findUnique.mockResolvedValue(null as never)
  mock.referral.groupBy.mockResolvedValue([] as never)
  // Both the referrer and the new customer are on Pro unless a test says
  // otherwise — planTierOf is asked about each of them at qualification.
  onPlan('pro')
}

/** The plan an account holds, which `planTierOf` reads. */
function onPlan(slug: 'pro' | 'club') {
  mock.userSubscription.findUnique.mockResolvedValue({ plan: { slug } } as never)
}

/** The referred customer's plan, then the referrer's (the order they're asked). */
function onPlans(referred: 'pro' | 'club', referrer: 'pro' | 'club') {
  mock.userSubscription.findUnique
    .mockResolvedValueOnce({ plan: { slug: referred } } as never)
    .mockResolvedValueOnce({ plan: { slug: referrer } } as never)
}

/**
 * Qualified referral counts, as the grouped query returns them.
 * `counts({ coach: { coach: 3 } })` = a Pro referrer with 3 paying coaches.
 */
function counts(spec: Partial<Record<'coach' | 'club', Partial<Record<'coach' | 'club', number>>>>) {
  const rows: unknown[] = []
  for (const [referrerTier, kinds] of Object.entries(spec)) {
    for (const [kind, n] of Object.entries(kinds ?? {})) {
      if (n) rows.push({ referrerTier, kind, _count: { _all: n } })
    }
  }
  mock.referral.groupBy.mockResolvedValue(rows as never)
}

beforeEach(() => {
  noRewards()
})

describe('ensureReferralCode', () => {
  it('mints a readable code from the first name and keeps it', async () => {
    mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: null, name: 'Priya' } as never)
    mock.user.update.mockResolvedValue({} as never)

    const code = await ensureReferralCode(1)
    expect(code).toMatch(/^PRIYA-[2-9A-HJ-NP-Z]{5}$/)
  })

  it('never contains a character that can be misread aloud', async () => {
    mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: null, name: 'Sam' } as never)
    mock.user.update.mockResolvedValue({} as never)

    for (let i = 0; i < 40; i++) {
      const code = (await ensureReferralCode(1)).split('-')[1]
      // 0/O and 1/I/L are exactly where a code read off a phone goes wrong.
      expect(code).not.toMatch(/[01OIL]/)
    }
  })

  it('returns the existing code rather than reissuing one', async () => {
    mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'PRIYA-7K2QM', name: 'Priya' } as never)

    expect(await ensureReferralCode(1)).toBe('PRIYA-7K2QM')
    expect(mock.user.update).not.toHaveBeenCalled()
  })

  it('falls back to COACH when the name has no letters', async () => {
    mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: null, name: '123' } as never)
    mock.user.update.mockResolvedValue({} as never)

    expect(await ensureReferralCode(1)).toMatch(/^COACH-/)
  })
})

describe('attachReferral', () => {
  it('credits the owner of the code', async () => {
    mock.user.findUnique.mockResolvedValue({ id: 7 } as never)
    mock.referral.create.mockResolvedValue({} as never)

    await attachReferral(99, 'priya-7k2qm')

    // Codes are stored and looked up uppercased — a coach typing their own
    // code in lower case must still land on the right account.
    expect(mock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { referralCode: 'PRIYA-7K2QM' } }),
    )
    expect(mock.referral.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ referrerId: 7, referredUserId: 99 }) }),
    )
  })

  it('ignores a missing, empty or unknown code without throwing', async () => {
    mock.user.findUnique.mockResolvedValue(null as never)

    await expect(attachReferral(99, undefined)).resolves.toBeUndefined()
    await expect(attachReferral(99, '   ')).resolves.toBeUndefined()
    await expect(attachReferral(99, 'NOPE-11111')).resolves.toBeUndefined()
    expect(mock.referral.create).not.toHaveBeenCalled()
  })

  it('refuses self-referral', async () => {
    mock.user.findUnique.mockResolvedValue({ id: 99 } as never)

    await attachReferral(99, 'SELF-22222')
    expect(mock.referral.create).not.toHaveBeenCalled()
  })

  it('survives a duplicate — the first claim on an account wins', async () => {
    mock.user.findUnique.mockResolvedValue({ id: 7 } as never)
    mock.referral.create.mockRejectedValue(new Error('Unique constraint failed'))

    await expect(attachReferral(99, 'PRIYA-7K2QM')).resolves.toBeUndefined()
  })
})

describe('qualifyReferral', () => {
  it('flips pending → qualified and recomputes the ladder', async () => {
    mock.referral.findUnique.mockResolvedValue({ id: 5, referrerId: 7, status: 'pending' } as never)
    mock.referral.update.mockResolvedValue({} as never)
    counts({ coach: { coach: 3 } })

    await qualifyReferral(99)

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'qualified' }) }),
    )
    // 3 paid referrals = the first rung.
    expect(mock.referralReward.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cycle: 1, tier: 3, months: 1 }) }),
    )
  })

  it('is idempotent — a replayed webhook grants nothing extra', async () => {
    mock.referral.findUnique.mockResolvedValue({ id: 5, referrerId: 7, status: 'qualified' } as never)

    await qualifyReferral(99)

    expect(mock.referral.update).not.toHaveBeenCalled()
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })

  it('does nothing for a customer nobody referred', async () => {
    mock.referral.findUnique.mockResolvedValue(null as never)

    await expect(qualifyReferral(99)).resolves.toBeUndefined()
    expect(mock.referral.update).not.toHaveBeenCalled()
  })
})

describe('syncRewards', () => {
  it('grants only the rungs not already on the ledger', async () => {
    counts({ coach: { coach: 8 } })
    mock.referralReward.findMany.mockResolvedValue([
      { id: 1, referrerTier: 'coach', kind: 'coach', cycle: 1, tier: 3, months: 1, appliedAt: new Date(), revokedAt: null },
    ] as never)

    await syncRewards(7)

    expect(mock.referralReward.create).toHaveBeenCalledTimes(1)
    expect(mock.referralReward.create).toHaveBeenCalledWith(
      // The rung ADDS 2, taking the running total to the 3 months promised.
      expect.objectContaining({ data: expect.objectContaining({ tier: 8, months: 2 }) }),
    )
  })

  it('grants nothing when the ledger is already complete', async () => {
    counts({ coach: { coach: 3 } })
    mock.referralReward.findMany.mockResolvedValue([
      { id: 1, referrerTier: 'coach', kind: 'coach', cycle: 1, tier: 3, months: 1, appliedAt: null, revokedAt: null },
    ] as never)

    await syncRewards(7)
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })

  it('revokes an UNAPPLIED reward when a reversal drops the count below its rung', async () => {
    counts({ coach: { coach: 2 } }) // was 3, one refunded
    mock.referralReward.findMany.mockResolvedValue([
      { id: 1, referrerTier: 'coach', kind: 'coach', cycle: 1, tier: 3, months: 1, appliedAt: null, revokedAt: null },
    ] as never)
    mock.referralReward.update.mockResolvedValue({} as never)

    await syncRewards(7)

    expect(mock.referralReward.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: { revokedAt: expect.any(Date) } }),
    )
  })

  it('leaves an ALREADY-APPLIED reward alone after a reversal', async () => {
    // Credit that has been spent cannot be un-spent. Absorbing one refund is a
    // better outcome than taking back a free month a coach has already used.
    counts({ coach: { coach: 2 } })
    mock.referralReward.findMany.mockResolvedValue([
      { id: 1, referrerTier: 'coach', kind: 'coach', cycle: 1, tier: 3, months: 1, appliedAt: new Date(), revokedAt: null },
    ] as never)

    await syncRewards(7)
    expect(mock.referralReward.update).not.toHaveBeenCalled()
  })

  it('un-revokes a reward that is earned back', async () => {
    counts({ coach: { coach: 3 } })
    mock.referralReward.findMany.mockResolvedValue([
      { id: 1, referrerTier: 'coach', kind: 'coach', cycle: 1, tier: 3, months: 1, appliedAt: null, revokedAt: new Date() },
    ] as never)
    mock.referralReward.update.mockResolvedValue({} as never)

    await syncRewards(7)
    expect(mock.referralReward.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: { revokedAt: null } }),
    )
  })

  it('grants the whole coach ladder at 12 — 12 months in total, not 16', async () => {
    counts({ coach: { coach: 12 } })

    await syncRewards(7)

    const granted = mock.referralReward.create.mock.calls.map((c) => (c[0] as { data: { months: number } }).data)
    // Increments, summing to the promised total. Storing 1 / 3 / 12 here would
    // quietly pay 16 months against a programme that advertises 12.
    expect(granted.map((g) => g.months)).toEqual([1, 2, 9])
    expect(granted.reduce((s, g) => s + g.months, 0)).toBe(12)
  })
})

describe('which ladder a referral lands on', () => {
  function pending() {
    mock.referral.findUnique.mockResolvedValue({ id: 5, referrerId: 7, status: 'pending' } as never)
    mock.referral.update.mockResolvedValue({} as never)
  }

  it('sends a customer who bought Club to the club ladder', async () => {
    pending()
    onPlans('club', 'pro')
    counts({ coach: { club: 1 } })

    await qualifyReferral(99)

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'club', referrerTier: 'coach' }) }),
    )
    // For a Pro referrer one club is already worth three months.
    expect(mock.referralReward.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'club', cycle: 1, tier: 1, months: 3 }),
      }),
    )
  })

  it('sends a Pro customer to the coach ladder, where one is not enough', async () => {
    pending()
    onPlans('pro', 'pro')
    counts({ coach: { coach: 1 } })

    await qualifyReferral(99)

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'coach' }) }),
    )
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })

  it('records the REFERRER’s plan too, so their thresholds are locked in', async () => {
    pending()
    onPlans('club', 'club')
    counts({ club: { club: 1 } })

    await qualifyReferral(99)

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'club', referrerTier: 'club' }) }),
    )
    // A Club referrer needs TWO clubs before anything pays.
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })

  it('pays a Club referrer on their second club', async () => {
    pending()
    onPlans('club', 'club')
    counts({ club: { club: 2 } })

    await qualifyReferral(99)

    expect(mock.referralReward.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ referrerTier: 'club', kind: 'club', tier: 2, months: 3 }),
      }),
    )
  })

  it('defaults to the coach tier when a plan cannot be read', async () => {
    // An account with no subscription row must not be silently promoted to
    // either the more valuable ladder or the more generous thresholds.
    pending()
    mock.userSubscription.findUnique.mockResolvedValue(null as never)
    counts({ coach: { coach: 1 } })

    await qualifyReferral(99)

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'coach', referrerTier: 'coach' }) }),
    )
  })
})

describe('the ladders together', () => {
  it('pays each kind on its own ladder, never pooled', async () => {
    // 3 coaches (1 month) and 2 clubs (6 months) for a Pro referrer. Pooling
    // them as "5 referrals" would pay 1 month; counting clubs as coaches would
    // pay nothing extra.
    counts({ coach: { coach: 3, club: 2 } })

    await syncRewards(7)

    const granted = mock.referralReward.create.mock.calls.map(
      (c) => (c[0] as { data: { kind: string; months: number } }).data,
    )
    expect(granted.filter((g) => g.kind === 'coach').reduce((s, g) => s + g.months, 0)).toBe(1)
    expect(granted.filter((g) => g.kind === 'club').reduce((s, g) => s + g.months, 0)).toBe(6)
    expect(granted.reduce((s, g) => s + g.months, 0)).toBe(7)
  })

  it('grants a Pro referrer the whole club ladder at 3 — 12 months', async () => {
    counts({ coach: { club: 3 } })

    await syncRewards(7)

    const granted = mock.referralReward.create.mock.calls.map(
      (c) => (c[0] as { data: { months: number } }).data,
    )
    expect(granted.reduce((s, g) => s + g.months, 0)).toBe(12)
  })

  it('makes a Club referrer reach 6 clubs for the same 12 months', async () => {
    counts({ club: { club: 6 } })

    await syncRewards(7)

    const granted = mock.referralReward.create.mock.calls.map(
      (c) => (c[0] as { data: { months: number } }).data,
    )
    expect(granted.reduce((s, g) => s + g.months, 0)).toBe(12)
  })

  it('keeps a referrer’s old-tier rewards when they change plan', async () => {
    // They earned 3 clubs' worth on Pro, then upgraded to Club and brought one
    // more. The Pro rewards must NOT be revoked — the referrals behind them are
    // untouched, and only a reversal may take a reward away.
    counts({ coach: { club: 3 }, club: { club: 1 } })
    mock.referralReward.findMany.mockResolvedValue([
      { id: 1, referrerTier: 'coach', kind: 'club', cycle: 1, tier: 1, months: 3, appliedAt: null, revokedAt: null },
      { id: 2, referrerTier: 'coach', kind: 'club', cycle: 1, tier: 2, months: 3, appliedAt: null, revokedAt: null },
      { id: 3, referrerTier: 'coach', kind: 'club', cycle: 1, tier: 3, months: 6, appliedAt: null, revokedAt: null },
    ] as never)
    mock.referralReward.update.mockResolvedValue({} as never)

    await syncRewards(7)

    expect(mock.referralReward.update).not.toHaveBeenCalled()
    // The single club on the Club tier has not reached that ladder's first rung.
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })

  it('does not confuse ledgers that share a cycle and rung number', async () => {
    // A Pro referrer's coach rung 3 and club rung 3 both exist at cycle 1.
    // Without `kind` in the ledger key one would suppress the other.
    counts({ coach: { coach: 12, club: 3 } })
    mock.referralReward.findMany.mockResolvedValue([
      { id: 1, referrerTier: 'coach', kind: 'club', cycle: 1, tier: 3, months: 6, appliedAt: null, revokedAt: null },
    ] as never)

    await syncRewards(7)

    const granted = mock.referralReward.create.mock.calls.map(
      (c) => (c[0] as { data: { kind: string; tier: number } }).data,
    )
    expect(granted).toContainEqual(expect.objectContaining({ kind: 'coach', tier: 3 }))
    expect(granted).not.toContainEqual(expect.objectContaining({ kind: 'club', tier: 3 }))
  })
})

describe('reverseReferral', () => {
  it('marks the referral reversed and recomputes', async () => {
    mock.referral.findUnique.mockResolvedValue({ id: 5, referrerId: 7, status: 'qualified' } as never)
    mock.referral.update.mockResolvedValue({} as never)
    counts({})

    await reverseReferral(99)

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'reversed' }) }),
    )
  })

  it('does not reverse twice', async () => {
    mock.referral.findUnique.mockResolvedValue({ id: 5, referrerId: 7, status: 'reversed' } as never)

    await reverseReferral(99)
    expect(mock.referral.update).not.toHaveBeenCalled()
  })
})
