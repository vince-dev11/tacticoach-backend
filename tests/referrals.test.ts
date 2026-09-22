// Referral attribution, qualification and payout.
//
// These use the deep Prisma mock, so they check the DECISIONS the service makes
// — who gets credited, when, and how many times — rather than SQL.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import {
  attachReferral,
  qualifyReferral,
  qualifyPendingFor,
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
  // Both accounts are on Pro, billed annually, unless a test says otherwise.
  // Annual is the default because it is the case with no waiting: the monthly
  // bar is a deliberate extra step and the tests that care about it say so.
  onPlans('pro', 'pro')
}

/** The referrer in these tests. The referred customer is 99. */
const REFERRER_ID = 7

type PlanSpec = Slug | { slug: Slug; billing: 'monthly' | 'annual' } | null
type Slug = 'basic' | 'pro' | 'club-5' | 'club-10' | 'club-20' | 'enterprise-mega'

const spec = (p: PlanSpec) => (p && typeof p === 'string' ? { slug: p, billing: 'annual' as const } : p)

/**
 * The referred customer's subscription and the referrer's, keyed BY USER ID.
 *
 * Keyed rather than mocked as two sequential calls, because mocking by
 * position encodes the order the service happens to ask in: adding one lookup
 * above them shifts every answer by one, and the tests then fail pointing at
 * the rate engine rather than at the fixture. This says what is true about
 * each account and does not care how often, or in what order, anyone asks.
 */
function onPlans(referred: PlanSpec, referrer: PlanSpec) {
  mock.userSubscription.findUnique.mockImplementation((args: any) => {
    const who = spec(args?.where?.userId === REFERRER_ID ? referrer : referred)
    return Promise.resolve(
      who ? { plan: { slug: who.slug }, status: 'active', billingCycle: who.billing } : null,
    ) as never
  })
}

/**
 * Qualified referral counts, as the grouped query returns them.
 *
 * `counts({ pro: { 'club-20': 2 } })` = a referrer on Pro who has brought two
 * paying Club 20s. Written as real plan slugs because the rate is computed
 * from real prices now — there is no tier to stand in for them.
 */
function counts(spec: Partial<Record<string, Partial<Record<string, number>>>>) {
  const rows: unknown[] = []
  for (const [referrerPlan, referredPlans] of Object.entries(spec)) {
    for (const [referredPlan, n] of Object.entries(referredPlans ?? {})) {
      if (n) rows.push({ referrerPlan, referredPlan, _count: { _all: n } })
    }
  }
  mock.referral.groupBy.mockResolvedValue(rows as never)
}

/** A ledger row, in the shape syncRewards reads. */
const reward = (
  id: number,
  referrerPlan: string,
  referredPlan: string,
  cycle: number,
  months: number,
  extra: { appliedAt?: Date | null; revokedAt?: Date | null } = {},
) => ({
  id,
  referrerPlan,
  referredPlan,
  cycle,
  every: 1,
  months,
  appliedAt: extra.appliedAt ?? null,
  revokedAt: extra.revokedAt ?? null,
})

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
  /** A referral waiting to be qualified, with no payments recorded yet. */
  function pending(extra: Record<string, unknown> = {}) {
    mock.referral.findUnique.mockResolvedValue({
      id: 5,
      referrerId: REFERRER_ID,
      status: 'pending',
      firstPaymentAt: null,
      firstInvoiceId: null,
      secondPaymentAt: null,
      ...extra,
    } as never)
    mock.referral.update.mockResolvedValue({} as never)
  }

  it('flips pending → qualified and recomputes, for an annual customer', async () => {
    pending()
    onPlans('club-20', 'pro')
    counts({ pro: { 'club-20': 1 } })

    await qualifyReferral(99, 'in_1')

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'qualified',
          referredPlan: 'club-20',
          referrerPlan: 'pro',
        }),
      }),
    )
    // A Pro referrer earns 7 months for a Club 20 — £62.93 against £700.
    expect(mock.referralReward.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cycle: 1, every: 1, months: 7 }) }),
    )
  })

  it('is idempotent — a replayed webhook grants nothing extra', async () => {
    mock.referral.findUnique.mockResolvedValue({
      id: 5,
      referrerId: REFERRER_ID,
      status: 'qualified',
      firstPaymentAt: new Date(),
      firstInvoiceId: 'in_1',
      secondPaymentAt: null,
    } as never)

    await qualifyReferral(99, 'in_1')

    expect(mock.referral.update).not.toHaveBeenCalled()
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })

  it('does nothing for a customer nobody referred', async () => {
    mock.referral.findUnique.mockResolvedValue(null as never)

    await expect(qualifyReferral(99, 'in_1')).resolves.toBeUndefined()
    expect(mock.referral.update).not.toHaveBeenCalled()
  })

  it('earns nothing while the referred customer is still on trial', async () => {
    // The anti-farming rule. Nothing is owed until money actually moves.
    pending()
    mock.userSubscription.findUnique.mockImplementation((args: any) =>
      Promise.resolve(
        args?.where?.userId === REFERRER_ID
          ? { plan: { slug: 'pro' }, status: 'active', billingCycle: 'annual' }
          : { plan: { slug: 'pro' }, status: 'trial', billingCycle: 'annual' },
      ) as never,
    )

    await qualifyReferral(99, 'in_1')
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })
})

describe('the monthly bar', () => {
  // An annual customer hands over twelve months on day one, so the reward is
  // safe the moment it is earned. A monthly customer has paid ONE instalment
  // — £4.99 on Basic — against a reward that can be worth more than that.
  // Waiting one cycle costs a real referrer a month's patience and caps what
  // an immediate churn can take out of us.
  function pending(extra: Record<string, unknown> = {}) {
    mock.referral.findUnique.mockResolvedValue({
      id: 5,
      referrerId: REFERRER_ID,
      status: 'pending',
      firstPaymentAt: null,
      firstInvoiceId: null,
      secondPaymentAt: null,
      ...extra,
    } as never)
    mock.referral.update.mockResolvedValue({} as never)
  }

  it('records the first payment but does NOT qualify a monthly customer', async () => {
    pending()
    onPlans({ slug: 'club-20', billing: 'monthly' }, 'pro')
    counts({ pro: { 'club-20': 1 } })

    await qualifyReferral(99, 'in_1')

    // The payment is recorded — losing it would mean the sweep later could
    // not tell a one-payment customer from a two-payment one.
    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ firstInvoiceId: 'in_1', firstPaymentAt: expect.any(Date) }),
      }),
    )
    // …but nothing is qualified and nothing is owed.
    expect(mock.referral.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'qualified' }) }),
    )
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })

  it('qualifies a monthly customer on their second payment', async () => {
    pending({ firstPaymentAt: new Date(), firstInvoiceId: 'in_1' })
    onPlans({ slug: 'club-20', billing: 'monthly' }, 'pro')
    counts({ pro: { 'club-20': 1 } })

    await qualifyReferral(99, 'in_2')

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ secondPaymentAt: expect.any(Date) }) }),
    )
    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'qualified' }) }),
    )
    expect(mock.referralReward.create).toHaveBeenCalled()
  })

  it('does NOT count a retried webhook as a second payment', async () => {
    // Without the invoice id, one payment replayed twice clears the bar on
    // its own and the whole rule is decorative. This is the test that makes
    // the `firstInvoiceId` column earn its place.
    pending({ firstPaymentAt: new Date(), firstInvoiceId: 'in_1' })
    onPlans({ slug: 'club-20', billing: 'monthly' }, 'pro')
    counts({ pro: { 'club-20': 1 } })

    await qualifyReferral(99, 'in_1')

    expect(mock.referral.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'qualified' }) }),
    )
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })

  it('qualifies an annual customer on the first payment, with no wait', async () => {
    pending()
    onPlans({ slug: 'club-20', billing: 'annual' }, 'pro')
    counts({ pro: { 'club-20': 1 } })

    await qualifyReferral(99, 'in_1')

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'qualified' }) }),
    )
  })

  it('treats an unknown billing cycle as annual rather than holding the reward', async () => {
    // A legacy row with no billing cycle is far more likely to be an annual
    // purchase than a trap, and holding a real referrer's reward hostage to a
    // null column is the worse failure.
    pending()
    mock.userSubscription.findUnique.mockImplementation((args: any) =>
      Promise.resolve({
        plan: { slug: args?.where?.userId === REFERRER_ID ? 'pro' : 'club-20' },
        status: 'active',
        billingCycle: null,
      }) as never,
    )
    counts({ pro: { 'club-20': 1 } })

    await qualifyReferral(99, 'in_1')
    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'qualified' }) }),
    )
  })

  it('remembers payments made while the referrer was still on the free tier', async () => {
    // The two rules compose: the referred customer's payments are counted
    // whatever the referrer is on, so a monthly customer who paid twice while
    // their referrer was free settles in full the day that referrer upgrades.
    // Recording the payment only once the referrer pays would lose the
    // history and make the sweep unable to tell one payment from two.
    mock.referral.findUnique.mockResolvedValue({
      id: 5,
      referrerId: REFERRER_ID,
      status: 'pending',
      firstPaymentAt: new Date(),
      firstInvoiceId: 'in_1',
      secondPaymentAt: null,
    } as never)
    mock.referral.update.mockResolvedValue({} as never)
    onPlans({ slug: 'club-20', billing: 'monthly' }, null)

    await qualifyReferral(99, 'in_2')

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ secondPaymentAt: expect.any(Date) }) }),
    )
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })
})

describe('syncRewards', () => {
  it('grants only the awards not already on the ledger', async () => {
    // Two Club 20s brought by a Club 5 referrer — two months each. One award
    // is already on the ledger; recomputing must not re-grant it.
    counts({ 'club-5': { 'club-20': 2 } })
    mock.referralReward.findMany.mockResolvedValue([
      reward(1, 'club-5', 'club-20', 1, 2, { appliedAt: new Date() }),
    ] as never)

    await syncRewards(REFERRER_ID)

    expect(mock.referralReward.create).toHaveBeenCalledTimes(1)
    expect(mock.referralReward.create).toHaveBeenCalledWith(
      // Award 2 — the same months every other award pays. No running totals.
      expect.objectContaining({ data: expect.objectContaining({ cycle: 2, months: 2 }) }),
    )
  })

  it('grants nothing when the ledger is already complete', async () => {
    counts({ pro: { 'club-20': 3 } })
    mock.referralReward.findMany.mockResolvedValue([
      reward(1, 'pro', 'club-20', 1, 7),
      reward(2, 'pro', 'club-20', 2, 7),
      reward(3, 'pro', 'club-20', 3, 7),
    ] as never)

    await syncRewards(REFERRER_ID)
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })

  it('revokes an UNAPPLIED reward the referrer no longer qualifies for', async () => {
    counts({ pro: { 'club-20': 2 } }) // was 3, one refunded
    mock.referralReward.findMany.mockResolvedValue([
      reward(1, 'pro', 'club-20', 1, 7),
      reward(2, 'pro', 'club-20', 2, 7),
      // Award 3 was earned by the referral that has since refunded.
      reward(3, 'pro', 'club-20', 3, 7),
    ] as never)
    mock.referralReward.update.mockResolvedValue({} as never)

    await syncRewards(REFERRER_ID)

    expect(mock.referralReward.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3 }, data: { revokedAt: expect.any(Date) } }),
    )
    // And only that one — the two still earned are left alone.
    expect(mock.referralReward.update).toHaveBeenCalledTimes(1)
  })

  it('leaves an ALREADY-APPLIED reward alone after a reversal', async () => {
    // Credit that has been spent cannot be un-spent. Absorbing one refund is
    // a better outcome than taking back a month a coach has already used.
    counts({ pro: { 'club-20': 2 } })
    mock.referralReward.findMany.mockResolvedValue([
      reward(3, 'pro', 'club-20', 3, 7, { appliedAt: new Date() }),
    ] as never)

    await syncRewards(REFERRER_ID)
    expect(mock.referralReward.update).not.toHaveBeenCalled()
  })

  it('un-revokes a reward that is earned back', async () => {
    counts({ pro: { 'club-20': 3 } })
    mock.referralReward.findMany.mockResolvedValue([
      reward(1, 'pro', 'club-20', 1, 7, { revokedAt: new Date() }),
    ] as never)
    mock.referralReward.update.mockResolvedValue({} as never)

    await syncRewards(REFERRER_ID)
    expect(mock.referralReward.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: { revokedAt: null } }),
    )
  })

  it('pays in equal awards, never one lump', async () => {
    // Twelve Club 5s brought by a Pro referrer: two months each, twelve
    // times. The old ladder's top rung paid 9 months at once, so bringing 11
    // coaches was worth 3 — that cliff is what equal awards remove.
    counts({ pro: { 'club-5': 12 } })

    await syncRewards(REFERRER_ID)

    const granted = mock.referralReward.create.mock.calls.map(
      (c) => (c[0] as { data: { months: number } }).data,
    )
    expect(granted.map((g) => g.months)).toEqual(Array(12).fill(2))
    expect(granted.reduce((s, g) => s + g.months, 0)).toBe(24)
  })
})

describe('which rate a referral lands on', () => {
  function pending() {
    mock.referral.findUnique.mockResolvedValue({
      id: 5,
      referrerId: REFERRER_ID,
      status: 'pending',
      firstPaymentAt: null,
      firstInvoiceId: null,
      secondPaymentAt: null,
    } as never)
    mock.referral.update.mockResolvedValue({} as never)
  }

  it('records BOTH plans, so the rate is locked in at qualification', async () => {
    // A referrer who later changes plan keeps the rate every earned award was
    // granted under. Reading either plan live instead would make a plan
    // change try to take rewards back.
    pending()
    onPlans('club-10', 'club-5')
    counts({ 'club-5': { 'club-10': 1 } })

    await qualifyReferral(99, 'in_1')

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ referredPlan: 'club-10', referrerPlan: 'club-5' }),
      }),
    )
  })

  it('gives Basic its own rate rather than quietly treating it as Pro', async () => {
    // The bug this whole rewrite exists to fix. There used to be two referrer
    // tiers, coach and club, so a Basic subscriber fell onto the Pro rate —
    // nobody decided that, it fell out of `isClubPlan(slug) ? 'club' : 'coach'`.
    pending()
    onPlans('club-20', 'basic')
    counts({ basic: { 'club-20': 1 } })

    await qualifyReferral(99, 'in_1')

    // A Basic month is £4.99, so 10% of a £700 Club 20 buys fourteen of them
    // — where a Pro referrer, whose month costs £8.99, gets seven.
    expect(mock.referralReward.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ referrerPlan: 'basic', months: 14 }) }),
    )
  })

  it('pays a club one free month for every club it brings', async () => {
    // The sentence the programme is sold on.
    pending()
    onPlans('club-20', 'club-20')
    counts({ 'club-20': { 'club-20': 2 } })

    await qualifyReferral(99, 'in_1')

    const granted = mock.referralReward.create.mock.calls.map(
      (c) => (c[0] as { data: { months: number } }).data,
    )
    expect(granted).toHaveLength(2)
    expect(granted.reduce((s, g) => s + g.months, 0)).toBe(2)
  })

  it('earns nothing from a plan we have no price for', async () => {
    // An unrecognised slug must not be silently promoted onto somebody else's
    // rate, and must not throw inside the webhook that pays everyone else.
    pending()
    onPlans('pro', 'enterprise-mega')
    counts({ 'enterprise-mega': { pro: 4 } })

    await qualifyReferral(99, 'in_1')

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ referrerPlan: 'enterprise-mega' }) }),
    )
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })
})

describe('a referrer on the free tier', () => {
  function pending() {
    mock.referral.findUnique.mockResolvedValue({
      id: 5,
      referrerId: REFERRER_ID,
      status: 'pending',
      firstPaymentAt: null,
      firstInvoiceId: null,
      secondPaymentAt: null,
    } as never)
    mock.referral.update.mockResolvedValue({} as never)
  }

  it('earns nothing yet — the programme pays in free months', async () => {
    // Granting months to someone who pays nothing would comp a subscription
    // they never bought, and "one month free" is not a reward you can give to
    // a person whose bill is already zero.
    pending()
    onPlans('pro', null)
    counts({ pro: { pro: 1 } })

    await qualifyReferral(99, 'in_1')

    expect(mock.referral.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'qualified' }) }),
    )
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })

  it('keeps the referral PENDING rather than discarding it', async () => {
    // The referral is real — someone paid us because of them. Throwing it
    // away would mean the coach who brought three customers has nothing to
    // show for it the day they upgrade, and they would be right to be cross.
    pending()
    onPlans('pro', null)
    counts({ pro: { pro: 1 } })

    await qualifyReferral(99, 'in_1')
    expect(mock.referral.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'reversed' }) }),
    )
  })

  it('is paid in full the moment they start paying', async () => {
    // The upgrade argument this creates is better than anything on the
    // pricing page: "you have three referrals waiting".
    mock.referral.findMany.mockResolvedValue([{ referredUserId: 99 }] as never)
    mock.referral.findUnique.mockResolvedValue({
      id: 5,
      referrerId: REFERRER_ID,
      status: 'pending',
      firstPaymentAt: new Date(),
      firstInvoiceId: 'in_1',
      secondPaymentAt: null,
    } as never)
    mock.referral.update.mockResolvedValue({} as never)
    onPlans('club-20', 'pro')
    counts({ pro: { 'club-20': 3 } })

    await qualifyPendingFor(REFERRER_ID)

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'qualified', referredPlan: 'club-20' }),
      }),
    )
    expect(mock.referralReward.create).toHaveBeenCalled()
  })

  it('settles nothing for a referred customer who never paid', async () => {
    // The anti-farming rule survives the sweep: a signup is still worth
    // nothing, however long it has been sitting in pending.
    mock.referral.findMany.mockResolvedValue([{ referredUserId: 99 }] as never)
    mock.referral.findUnique.mockResolvedValue({
      id: 5,
      referrerId: REFERRER_ID,
      status: 'pending',
      firstPaymentAt: null,
      firstInvoiceId: null,
      secondPaymentAt: null,
    } as never)
    onPlans('pro', 'pro')

    await qualifyPendingFor(REFERRER_ID)

    expect(mock.referral.update).not.toHaveBeenCalled()
  })

  it('does not advance anybody’s payment count during the sweep', async () => {
    // The sweep fires on the REFERRER's payment, not the referred customer's.
    // If it counted as one, a free referrer upgrading would push every one of
    // their monthly referrals past the bar for free.
    mock.referral.findMany.mockResolvedValue([{ referredUserId: 99 }] as never)
    mock.referral.findUnique.mockResolvedValue({
      id: 5,
      referrerId: REFERRER_ID,
      status: 'pending',
      firstPaymentAt: new Date(),
      firstInvoiceId: 'in_1',
      secondPaymentAt: null,
    } as never)
    mock.referral.update.mockResolvedValue({} as never)
    onPlans({ slug: 'club-20', billing: 'monthly' }, 'pro')
    counts({ pro: { 'club-20': 1 } })

    await qualifyPendingFor(REFERRER_ID)

    expect(mock.referral.update).not.toHaveBeenCalled()
    expect(mock.referralReward.create).not.toHaveBeenCalled()
  })

  it('does nothing at all if the sweep is run for someone still on free', async () => {
    onPlans('pro', null)
    await qualifyPendingFor(REFERRER_ID)
    expect(mock.referral.findMany).not.toHaveBeenCalled()
  })
})

describe('the pairings together', () => {
  it('pays each plan on its own pairing, never pooled', async () => {
    // A Pro referrer with 4 Club 5s (2 months each = 8) and 2 Club 20s
    // (7 months each = 14). Pooling them as "6 clubs" would pay something
    // else entirely.
    counts({ pro: { 'club-5': 4, 'club-20': 2 } })

    await syncRewards(REFERRER_ID)

    const granted = mock.referralReward.create.mock.calls.map(
      (c) => (c[0] as { data: { referredPlan: string; months: number } }).data,
    )
    const forPlan = (slug: string) =>
      granted.filter((g) => g.referredPlan === slug).reduce((s, g) => s + g.months, 0)
    expect(forPlan('club-5')).toBe(8)
    expect(forPlan('club-20')).toBe(14)
    expect(granted.reduce((s, g) => s + g.months, 0)).toBe(22)
  })

  it('keeps rewards earned on a previous plan when the referrer changes plan', async () => {
    // They earned three Club 20s' worth on Pro, then moved to Club 20 and
    // brought one more. The Pro rewards must NOT be revoked — the referrals
    // behind them are untouched, and only a reversal may take a reward away.
    counts({ pro: { 'club-20': 3 }, 'club-20': { 'club-20': 1 } })
    mock.referralReward.findMany.mockResolvedValue([
      reward(1, 'pro', 'club-20', 1, 7),
      reward(2, 'pro', 'club-20', 2, 7),
      reward(3, 'pro', 'club-20', 3, 7),
    ] as never)
    mock.referralReward.update.mockResolvedValue({} as never)

    await syncRewards(REFERRER_ID)

    expect(mock.referralReward.update).not.toHaveBeenCalled()
    // The new one pays the CLUB 20 rate — one month, not the seven it would
    // have earned on Pro. That is the rate they are on now.
    expect(mock.referralReward.create).toHaveBeenCalledTimes(1)
    expect(mock.referralReward.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ referrerPlan: 'club-20', months: 1 }),
      }),
    )
  })

  it('does not confuse ledgers that share an award number', async () => {
    // A Pro referrer's club-5 award 1 and club-20 award 1 both exist. Without
    // the referred plan in the ledger key, one would suppress the other.
    counts({ pro: { 'club-5': 3, 'club-20': 3 } })
    mock.referralReward.findMany.mockResolvedValue([
      reward(1, 'pro', 'club-20', 1, 7),
    ] as never)

    await syncRewards(REFERRER_ID)

    const granted = mock.referralReward.create.mock.calls.map(
      (c) => (c[0] as { data: { referredPlan: string; cycle: number } }).data,
    )
    // club-5 award 1 is still owed — the club-20 row on the ledger must not
    // have satisfied it just because they share the number 1.
    expect(granted).toContainEqual(expect.objectContaining({ referredPlan: 'club-5', cycle: 1 }))
    // club-20 award 1 is already on the ledger and must not be granted twice.
    expect(granted).not.toContainEqual(expect.objectContaining({ referredPlan: 'club-20', cycle: 1 }))
    expect(granted).toContainEqual(expect.objectContaining({ referredPlan: 'club-20', cycle: 2 }))
  })
})

describe('reverseReferral', () => {
  it('marks the referral reversed and recomputes', async () => {
    mock.referral.findUnique.mockResolvedValue({ id: 5, referrerId: REFERRER_ID, status: 'qualified' } as never)
    mock.referral.update.mockResolvedValue({} as never)
    counts({})

    await reverseReferral(99)

    expect(mock.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'reversed' }) }),
    )
  })

  it('does not reverse twice', async () => {
    mock.referral.findUnique.mockResolvedValue({ id: 5, referrerId: REFERRER_ID, status: 'reversed' } as never)

    await reverseReferral(99)
    expect(mock.referral.update).not.toHaveBeenCalled()
  })
})
