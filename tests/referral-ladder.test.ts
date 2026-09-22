// What we owe people, and the one promise that bounds it.
//
// The programme has exactly one business number — a referral never pays out
// more than 10% of what that customer pays us in their first year — and every
// rate is computed from it. So the tests that matter are not "does 4 × 2 come
// to 8"; they are:
//
//   * THE CAP HOLDS FOR EVERY PLAN PAIR, in every billing combination. Not a
//     handful of chosen ratios. The previous version of this file asserted
//     five, all of which assumed a referred coach bought Pro at £79 — and
//     referred coaches buy Basic at £45, where the real cost was 39%. Five
//     passing assertions and an unguarded worst case.
//   * THE GUARD CAN FAIL. A test that cannot fail proves nothing, so the cap
//     is mutation-checked below against a deliberately over-generous rate.
//   * THE PUBLISHED GRID IS PINNED. The rates are derived, so a price change
//     moves them silently and correctly. That is the point — but it must not
//     be invisible, so today's grid is written out as literals and a price
//     edit that moves a headline number fails here with the new one.
//   * AWARD NUMBERS ARE 1, 2, 3… with no gaps or repeats, because that number
//     is the ledger's idempotency key. A duplicate pays twice, a gap pays
//     nothing.

import { describe, it, expect } from 'vitest'
import { SEED_PLANS } from '../prisma/plans.js'
import {
  REWARD_CAP_PERCENT,
  rateFor,
  costShare,
  owedRewards,
  allOwedRewards,
  monthsEarned,
  totalMonthsEarned,
  ladderProgress,
  pairKey,
  type PairCounts,
  type PlanPrice,
} from '../src/lib/referral-ladder.js'

const pence = (v: string) => Math.round(Number(v) * 100)

/** Every plan that can actually be bought for a year, from the seed table. */
const PRICES: PlanPrice[] = SEED_PLANS.filter((p) => p.isActive && Number(p.annualPrice) > 0).map(
  (p) => ({
    slug: p.slug,
    monthlyPence: pence(p.monthlyPrice),
    annualPence: pence(p.annualPrice),
  }),
)

const by = (slug: string): PlanPrice => {
  const found = PRICES.find((p) => p.slug === slug)
  if (!found) throw new Error(`no price for ${slug} — did a slug change?`)
  return found
}

/** The five plans the public grid is written for. */
const SELLABLE = ['basic', 'pro', 'club-5', 'club-10', 'club-20']
const PAIRS = SELLABLE.flatMap((r) => SELLABLE.map((k) => [r, k] as const))

describe('the price table the rates are derived from', () => {
  it('has all five sellable plans, so the guard below is not vacuous', () => {
    // The first version of a guard like this globbed zero files and passed.
    // Check the input exists before trusting what it proves.
    for (const slug of SELLABLE) expect(by(slug).monthlyPence).toBeGreaterThan(0)
    expect(PRICES.length).toBeGreaterThanOrEqual(SELLABLE.length)
  })

  it('prices club annual at ten times monthly or better', () => {
    // Load-bearing, not tidy. One free month is 1/N of an annual subscription
    // where N = annual ÷ monthly, so a club at 10× or more makes a month
    // ≤10% — inside the cap — and one free month per club referred becomes
    // affordable. At £249 (9.96×) it was 10.04% and the reward had to halve
    // to one per two. The round £250/£400/£700 clear it with a little to
    // spare, which is the point: nine pence of headroom is not headroom.
    for (const slug of ['club-5', 'club-10', 'club-20']) {
      const p = by(slug)
      expect(p.annualPence, `${slug} annual`).toBeGreaterThanOrEqual(p.monthlyPence * 10)
      // …and the property that actually matters, stated directly.
      expect(p.monthlyPence / p.annualPence).toBeLessThanOrEqual(REWARD_CAP_PERCENT / 100)
    }
  })

  it('prices coach annual at about nine times monthly, which is why their diagonal differs', () => {
    // Basic and Pro give a deeper annual discount, so a free month is ~11% of
    // one annual subscription and cannot be earned from a single same-plan
    // referral. If anybody asks why Pro needs two Pro referrals for a month,
    // this is the reason and it is arithmetic rather than policy.
    for (const slug of ['basic', 'pro']) {
      const p = by(slug)
      const months = p.annualPence / p.monthlyPence
      expect(months, `${slug} annual in months`).toBeLessThan(10)
      expect(months).toBeGreaterThan(8)
      expect(p.monthlyPence / p.annualPence).toBeGreaterThan(REWARD_CAP_PERCENT / 100)
    }
  })
})

describe('the 10% cap, over every plan pair and every way of billing', () => {
  // The referrer's free month costs MOST when they bill monthly (a Pro on
  // annual gives up £79/12 = £6.58, not £8.99). The referred customer pays
  // LEAST when they bill annually (£700 against £839.88 over twelve months).
  // So there is exactly one worst case, and the rate is sized on it — which
  // means checking all four proves the other three are slack, not that they
  // were each tuned.
  const monthCost = (p: PlanPrice, billing: 'monthly' | 'annual') =>
    billing === 'monthly' ? p.monthlyPence : p.annualPence / 12
  const yearRevenue = (p: PlanPrice, billing: 'monthly' | 'annual') =>
    billing === 'annual' ? p.annualPence : p.monthlyPence * 12

  it.each(PAIRS)('%s referring %s never exceeds the cap, however either of them pays', (r, k) => {
    const referrer = by(r)
    const referred = by(k)
    const rate = rateFor(referrer, referred)
    for (const rb of ['monthly', 'annual'] as const) {
      for (const kb of ['monthly', 'annual'] as const) {
        const share =
          (rate.months * monthCost(referrer, rb)) / (rate.every * yearRevenue(referred, kb))
        expect(share, `${r}(${rb}) → ${k}(${kb})`).toBeLessThanOrEqual(REWARD_CAP_PERCENT / 100)
      }
    }
  })

  it('holds for every pair of plans we sell, not just the five in the grid', () => {
    // Legacy and retired plans are still reachable: a referrer can hold rows
    // on a plan we no longer sell. The cap is a promise about money, so it
    // has to survive them too.
    for (const referrer of PRICES) {
      for (const referred of PRICES) {
        expect(
          costShare(referrer, referred),
          `${referrer.slug} → ${referred.slug}`,
        ).toBeLessThanOrEqual(REWARD_CAP_PERCENT / 100)
      }
    }
  })

  it('gives away as much as the cap allows, not less', () => {
    // The other half of the guard. A rate of "one month per thousand" would
    // pass every assertion above and be worthless, so check that one more
    // month — or one fewer referral — would breach.
    for (const [r, k] of PAIRS) {
      const referrer = by(r)
      const referred = by(k)
      const rate = rateFor(referrer, referred)
      const greedier =
        rate.every > 1
          ? { every: rate.every - 1, months: rate.months }
          : { every: 1, months: rate.months + 1 }
      expect(
        costShare(referrer, referred, greedier),
        `${r} → ${k} could have afforded ${JSON.stringify(greedier)}`,
      ).toBeGreaterThan(REWARD_CAP_PERCENT / 100)
    }
  })

  it('would fail if a rate were made more generous — the guard can fail', () => {
    // Mutation check. Without this the three tests above are only evidence
    // that nothing currently breaches, not that a breach would be caught.
    const referrer = by('club-20')
    const referred = by('basic')
    const overGenerous = { every: 1, months: 1 } // a Club 20 month for one Basic coach
    expect(costShare(referrer, referred, overGenerous)).toBeGreaterThan(REWARD_CAP_PERCENT / 100)
    expect(costShare(referrer, referred, overGenerous)).toBeGreaterThan(1.5)
  })
})

describe('the grid as published', () => {
  // Literals on purpose. The rates are derived, so a price change moves them —
  // correctly, and that is the design — but it must not move them silently.
  // If this table fails, a price changed: read the new numbers, check them
  // against the cap (the tests above already have), and update the website.
  const expected: Record<string, Record<string, [number, number]>> = {
    //                  referred:  basic     pro       club-5    club-10   club-20
    //                             [every, months]
    basic: { basic: [2, 1], pro: [1, 1], 'club-5': [1, 5], 'club-10': [1, 8], 'club-20': [1, 14] },
    pro: { basic: [2, 1], pro: [2, 1], 'club-5': [1, 2], 'club-10': [1, 4], 'club-20': [1, 7] },
    'club-5': { basic: [6, 1], pro: [4, 1], 'club-5': [1, 1], 'club-10': [1, 1], 'club-20': [1, 2] },
    'club-10': { basic: [9, 1], pro: [6, 1], 'club-5': [2, 1], 'club-10': [1, 1], 'club-20': [1, 1] },
    'club-20': { basic: [16, 1], pro: [9, 1], 'club-5': [3, 1], 'club-10': [2, 1], 'club-20': [1, 1] },
  }

  it.each(PAIRS)('%s referring %s pays the published rate', (r, k) => {
    const [every, months] = expected[r]![k]!
    expect(rateFor(by(r), by(k))).toEqual({ every, months })
  })

  it('pays one free month for every club a club brings', () => {
    // The sentence the programme is sold on, and the reason club annual went
    // up a pound. Worth its own test so that nobody restores £249 without
    // finding out what it costs them.
    for (const slug of ['club-5', 'club-10', 'club-20']) {
      expect(rateFor(by(slug), by(slug)), slug).toEqual({ every: 1, months: 1 })
    }
  })

  it('pays a Basic coach a free year for bringing a Club 20', () => {
    // Months invert — a Basic month is a fourteenth of a Club 20 month — and
    // that is correct rather than a bug to be "fixed" by capping it.
    expect(monthsEarned(rateFor(by('basic'), by('club-20')), 1)).toBeGreaterThanOrEqual(12)
  })

  it('never asks anyone for more than twenty referrals to earn anything', () => {
    // A rate nobody can reach is the same as no rate. This is the sanity
    // bound on the cap: if a future price made it 40 referrals per month, the
    // answer is a different reward, not a bigger number.
    for (const [r, k] of PAIRS) expect(rateFor(by(r), by(k)).every, `${r} → ${k}`).toBeLessThanOrEqual(20)
  })
})

describe('what a referrer has earned', () => {
  const proToClub20 = rateFor(by('pro'), by('club-20'))
  const club20ToBasic = rateFor(by('club-20'), by('basic'))

  it('pays from the very first referral when the rate is one-for-one', () => {
    expect(monthsEarned(proToClub20, 1)).toBe(proToClub20.months)
    expect(monthsEarned(proToClub20, 3)).toBe(proToClub20.months * 3)
  })

  it('pays nothing until the count reaches the rate', () => {
    expect(monthsEarned(club20ToBasic, club20ToBasic.every - 1)).toBe(0)
    expect(monthsEarned(club20ToBasic, club20ToBasic.every)).toBe(1)
  })

  it('keeps paying forever — there is no last rung to reach', () => {
    // The old ladder stopped at 12 and started a new pass. The whole point of
    // a flat rate is that the hundredth referral pays like the first.
    expect(monthsEarned({ every: 1, months: 1 }, 100)).toBe(100)
    expect(monthsEarned({ every: 4, months: 1 }, 400)).toBe(100)
  })

  it('has no cliff', () => {
    // Under the old ladder the 12th coach alone was worth 9 months, so
    // somebody who brought 11 got one month and felt cheated. Every step must
    // be worth what every other step is worth.
    const rate = rateFor(by('pro'), by('club-10'))
    const steps = Array.from(
      { length: 24 },
      (_, i) => monthsEarned(rate, i + 1) - monthsEarned(rate, i),
    )
    expect(new Set(steps)).toEqual(new Set([rate.months]))
  })

  it.each(PAIRS)('%s / %s earns nothing from nothing', (r, k) => {
    const rate = rateFor(by(r), by(k))
    expect(monthsEarned(rate, 0)).toBe(0)
    // Negative is not reachable through the app, but a count is derived from
    // a query and a query can surprise you.
    expect(monthsEarned(rate, -5)).toBe(0)
  })

  it.each(PAIRS)('%s / %s never goes down as referrals go up', (r, k) => {
    const rate = rateFor(by(r), by(k))
    let previous = 0
    for (let n = 0; n <= 50; n++) {
      const now = monthsEarned(rate, n)
      expect(now).toBeGreaterThanOrEqual(previous)
      previous = now
    }
  })
})

describe('the award numbers the ledger keys on', () => {
  it.each(PAIRS)('%s / %s numbers awards 1, 2, 3… with no gaps', (r, k) => {
    const rate = rateFor(by(r), by(k))
    const rewards = owedRewards(r, k, rate, rate.every * 5)
    expect(rewards.map((x) => x.cycle)).toEqual([1, 2, 3, 4, 5])
  })

  it.each(PAIRS)('%s / %s issues each award exactly once', (r, k) => {
    const rate = rateFor(by(r), by(k))
    const rewards = owedRewards(r, k, rate, 40)
    const keys = rewards.map((x) => `${x.referrerPlan}:${x.referredPlan}:${x.cycle}`)
    // A duplicate key would be rejected by the unique index — the safety net,
    // not the design. The design is that this never produces one.
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('records the rate in force on each award', () => {
    // Same reason the collaboration programme copies its commission rate onto each
    // statement line: changing a price must never restate history.
    const rate = rateFor(by('club-20'), by('basic'))
    const rewards = owedRewards('club-20', 'basic', rate, rate.every * 2)
    expect(rewards.map((x) => x.every)).toEqual([rate.every, rate.every])
  })

  it.each(PAIRS)('%s / %s totals its awards to what was earned', (r, k) => {
    const rate = rateFor(by(r), by(k))
    for (const n of [0, 1, 3, 4, 7, 12, 25]) {
      const summed = owedRewards(r, k, rate, n).reduce((s, x) => s + x.months, 0)
      expect(summed, `${n} referrals`).toBe(monthsEarned(rate, n))
    }
  })

  it('grows the list by one award at a time, never rewriting the earlier ones', () => {
    // Recomputing from scratch after a webhook retry must produce a prefix of
    // what it produced before, or the ledger and the recompute disagree.
    const rate = rateFor(by('pro'), by('club-20'))
    let previous = owedRewards('pro', 'club-20', rate, 0)
    for (let n = 1; n <= 20; n++) {
      const now = owedRewards('pro', 'club-20', rate, n)
      expect(now.slice(0, previous.length)).toEqual(previous)
      previous = now
    }
  })
})

describe('the pairings never pool', () => {
  const prices = (slug: string) => PRICES.find((p) => p.slug === slug)

  it('counts a club on the club pairing only', () => {
    const counts: PairCounts = new Map([
      [pairKey('pro', 'pro'), 2],
      [pairKey('pro', 'club-20'), 1],
    ])
    const expected =
      monthsEarned(rateFor(by('pro'), by('pro')), 2) +
      monthsEarned(rateFor(by('pro'), by('club-20')), 1)
    expect(totalMonthsEarned(counts, prices)).toBe(expected)
    // …and specifically NOT what you would get by adding the counts first.
    expect(totalMonthsEarned(counts, prices)).not.toBe(
      monthsEarned(rateFor(by('pro'), by('pro')), 3),
    )
  })

  it('keeps a referrer’s old plan and new plan apart', () => {
    // Somebody who moved from Pro to Club 10 has rows on both. Everything
    // already earned stays earned; the new rate applies from here.
    const counts: PairCounts = new Map([
      [pairKey('pro', 'pro'), 2],
      [pairKey('club-10', 'pro'), 6],
    ])
    const expected =
      monthsEarned(rateFor(by('pro'), by('pro')), 2) +
      monthsEarned(rateFor(by('club-10'), by('pro')), 6)
    expect(totalMonthsEarned(counts, prices)).toBe(expected)
  })

  it('earns nothing from a plan we no longer have a price for', () => {
    // A retired plan must not be able to throw inside the webhook that pays
    // everybody else.
    const counts: PairCounts = new Map([[pairKey('pro', 'vanished-plan'), 10]])
    expect(allOwedRewards(counts, prices)).toEqual([])
    expect(totalMonthsEarned(counts, prices)).toBe(0)
  })

  it('totals an empty ledger to nothing', () => {
    expect(totalMonthsEarned(new Map(), prices)).toBe(0)
    expect(allOwedRewards(new Map(), prices)).toEqual([])
  })
})

describe('what the progress bar shows', () => {
  it('always has a next award to point at', () => {
    for (const n of [0, 1, 4, 11, 99]) {
      expect(ladderProgress(by('club-20'), by('basic'), n).next).not.toBeNull()
    }
  })

  it('counts down to the next award', () => {
    const rate = rateFor(by('club-20'), by('basic'))
    const at = (n: number) => ladderProgress(by('club-20'), by('basic'), n).next.inMore
    expect(at(0)).toBe(rate.every)
    expect(at(1)).toBe(rate.every - 1)
    // Landing exactly on an award resets the countdown to a full rate rather
    // than reading zero — "0 more to go" next to an award already paid is the
    // kind of off-by-one a coach screenshots and sends you.
    expect(at(rate.every)).toBe(rate.every)
    expect(at(rate.every + 1)).toBe(rate.every - 1)
  })

  it('agrees with the payout engine at every count', () => {
    // A progress bar that disagrees with the ledger is a support ticket that
    // takes an hour to unpick.
    for (const [r, k] of PAIRS) {
      const rate = rateFor(by(r), by(k))
      for (let n = 0; n <= 30; n++) {
        expect(ladderProgress(by(r), by(k), n).monthsEarned).toBe(monthsEarned(rate, n))
      }
    }
  })

  it('treats a negative count as zero rather than going backwards', () => {
    const progress = ladderProgress(by('pro'), by('pro'), -3)
    expect(progress.qualified).toBe(0)
    expect(progress.monthsEarned).toBe(0)
  })
})

describe('plans that cannot earn', () => {
  const free: PlanPrice = { slug: 'free', monthlyPence: 0, annualPence: 0 }

  it('gives a free referrer nothing, without dividing by zero', () => {
    const rate = rateFor(free, by('club-20'))
    expect(rate.months).toBe(0)
    expect(monthsEarned(rate, 100)).toBe(0)
    expect(owedRewards('free', 'club-20', rate, 100)).toEqual([])
    expect(costShare(free, by('club-20'))).toBe(0)
  })

  it('earns nothing for referring someone onto a free plan', () => {
    const rate = rateFor(by('pro'), free)
    expect(rate.months).toBe(0)
    expect(owedRewards('pro', 'free', rate, 50)).toEqual([])
  })
})
