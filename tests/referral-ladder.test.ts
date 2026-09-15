// The ladders decide what we owe people, so they get tested at every boundary
// rather than at a few happy numbers.
//
// The single most valuable assertion in this file is that the RUNNING TOTALS
// match what was promised. The rungs are stored as increments, so an off-by-one
// in that conversion pays 16 months where 12 was agreed and nobody notices
// until someone adds up their statement.

import { describe, it, expect } from 'vitest'
import {
  LADDERS,
  tiersFor,
  cycleLength,
  owedRewards,
  allOwedRewards,
  emptyCounts,
  monthsEarned,
  totalMonthsEarned,
  ladderProgress,
  cumulativeAt,
  type ReferrerTier,
  type ReferralKind,
} from '../src/lib/referral-ladder.js'

const REFERRERS: ReferrerTier[] = ['coach', 'club']
const KINDS: ReferralKind[] = ['coach', 'club']

/** Every (referrer, kind) pair, for the invariants that must hold on all four. */
const ALL = REFERRERS.flatMap((r) => KINDS.map((k) => [r, k] as const))

describe('the promised totals', () => {
  it('a Pro referrer bringing coaches: 3 → 1, 8 → 3, 12 → 12', () => {
    expect(cumulativeAt('coach', 'coach', 3)).toBe(1)
    expect(cumulativeAt('coach', 'coach', 8)).toBe(3)
    expect(cumulativeAt('coach', 'coach', 12)).toBe(12)
  })

  it('a Pro referrer bringing clubs: 1 → 3, 2 → 6, 3 → 12', () => {
    expect(cumulativeAt('coach', 'club', 1)).toBe(3)
    expect(cumulativeAt('coach', 'club', 2)).toBe(6)
    expect(cumulativeAt('coach', 'club', 3)).toBe(12)
  })

  it('a Club referrer bringing coaches: 6 → 1, 16 → 3, 24 → 12', () => {
    expect(cumulativeAt('club', 'coach', 6)).toBe(1)
    expect(cumulativeAt('club', 'coach', 16)).toBe(3)
    expect(cumulativeAt('club', 'coach', 24)).toBe(12)
  })

  it('a Club referrer bringing clubs: 2 → 3, 3 → 6, 6 → 12', () => {
    expect(cumulativeAt('club', 'club', 2)).toBe(3)
    expect(cumulativeAt('club', 'club', 3)).toBe(6)
    expect(cumulativeAt('club', 'club', 6)).toBe(12)
  })

  it('caps every ladder at 12 months a pass', () => {
    for (const [referrer, kind] of ALL) {
      const top = cycleLength(referrer, kind)
      expect(cumulativeAt(referrer, kind, top)).toBe(12)
    }
  })
})

describe('the ladder shapes', () => {
  it('asks a Club referrer for roughly twice as many people', () => {
    // A free month is worth £24.99 to a Club and £2.99 to a Pro coach. Without
    // higher thresholds the same programme costs eight times more for the
    // accounts best placed to work it.
    for (const kind of KINDS) {
      const pro = tiersFor('coach', kind)
      const club = tiersFor('club', kind)
      for (let i = 0; i < pro.length; i++) {
        expect(club[i].at).toBeGreaterThan(pro[i].at)
      }
    }
  })

  it('pays the same rewards on both, only later', () => {
    for (const kind of KINDS) {
      expect(tiersFor('coach', kind).map((t) => t.months)).toEqual(
        tiersFor('club', kind).map((t) => t.months),
      )
    }
  })

  it.each(ALL)('%s referrer / %s ladder has strictly increasing rungs', (referrer, kind) => {
    const tiers = tiersFor(referrer, kind)
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].at).toBeGreaterThan(tiers[i - 1].at)
    }
  })

  it('has four distinct ladders', () => {
    expect(Object.keys(LADDERS)).toEqual(['coach', 'club'])
    expect(new Set(ALL.map(([r, k]) => tiersFor(r, k).map((t) => t.at).join('-'))).size).toBe(4)
  })
})

describe('owedRewards', () => {
  it('owes nothing below the first rung', () => {
    for (const [referrer, kind] of ALL) {
      const first = tiersFor(referrer, kind)[0].at
      expect(owedRewards(referrer, kind, first - 1)).toEqual([])
      expect(owedRewards(referrer, kind, 0)).toEqual([])
      expect(owedRewards(referrer, kind, -5)).toEqual([])
    }
  })

  it('pays a Pro coach exactly at each rung and not before', () => {
    expect(monthsEarned('coach', 'coach', 2)).toBe(0)
    expect(monthsEarned('coach', 'coach', 3)).toBe(1)
    expect(monthsEarned('coach', 'coach', 7)).toBe(1)
    expect(monthsEarned('coach', 'coach', 8)).toBe(3)
    expect(monthsEarned('coach', 'coach', 11)).toBe(3)
    expect(monthsEarned('coach', 'coach', 12)).toBe(12)
  })

  it('makes a Club wait for the same rewards', () => {
    expect(monthsEarned('club', 'coach', 5)).toBe(0)
    expect(monthsEarned('club', 'coach', 6)).toBe(1)
    expect(monthsEarned('club', 'coach', 15)).toBe(1)
    expect(monthsEarned('club', 'coach', 16)).toBe(3)
    expect(monthsEarned('club', 'coach', 24)).toBe(12)
  })

  it('re-earns the whole ladder on the next pass', () => {
    expect(monthsEarned('coach', 'club', 3)).toBe(12)
    expect(monthsEarned('coach', 'club', 4)).toBe(15)
    expect(monthsEarned('coach', 'club', 6)).toBe(24)
    expect(monthsEarned('club', 'club', 6)).toBe(12)
    expect(monthsEarned('club', 'club', 12)).toBe(24)
  })

  it('labels each reward with the ladder, cycle and rung that earned it', () => {
    expect(owedRewards('coach', 'club', 4)).toEqual([
      { referrerTier: 'coach', kind: 'club', cycle: 1, tier: 1, months: 3 },
      { referrerTier: 'coach', kind: 'club', cycle: 1, tier: 2, months: 3 },
      { referrerTier: 'coach', kind: 'club', cycle: 1, tier: 3, months: 6 },
      { referrerTier: 'coach', kind: 'club', cycle: 2, tier: 1, months: 3 },
    ])
  })
})

describe('all four ladders together', () => {
  it('keeps every ladder separate — a club never counts as a coach', () => {
    const counts = emptyCounts()
    counts.coach.coach = 3
    counts.coach.club = 2
    const owed = allOwedRewards(counts)

    expect(owed.filter((r) => r.kind === 'coach').reduce((s, r) => s + r.months, 0)).toBe(1)
    expect(owed.filter((r) => r.kind === 'club').reduce((s, r) => s + r.months, 0)).toBe(6)
    expect(totalMonthsEarned(counts)).toBe(7)
  })

  it('produces no duplicate (referrerTier, kind, cycle, tier) keys', () => {
    // This tuple is the ledger's unique key. Two ladders share rung numbers —
    // a Pro referrer's club rung 3 and their coach... there is no coach rung 3
    // collision, but a Club referrer's club rung 3 and 6 sit inside the coach
    // ladder's range. Without every field in the key one would suppress another.
    const counts = emptyCounts()
    for (const n of [0, 1, 3, 8, 12, 16, 24, 30]) {
      counts.coach.coach = n
      counts.coach.club = n
      counts.club.coach = n
      counts.club.club = n
      const keys = allOwedRewards(counts).map(
        (r) => `${r.referrerTier}:${r.kind}:${r.cycle}:${r.tier}`,
      )
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('starts at zero on every ladder', () => {
    expect(totalMonthsEarned(emptyCounts())).toBe(0)
    expect(allOwedRewards(emptyCounts())).toEqual([])
  })
})

describe.each(ALL)('%s referrer / %s ladder invariants', (referrer, kind) => {
  const top = cycleLength(referrer, kind)

  it('only ever grows as referrals are added', () => {
    // Recomputing from scratch must never take a reward away from someone who
    // gained a referral — that would show up as a revocation on their statement.
    for (let n = 1; n <= top * 3; n++) {
      expect(monthsEarned(referrer, kind, n)).toBeGreaterThanOrEqual(
        monthsEarned(referrer, kind, n - 1),
      )
    }
  })

  it('is a superset as the count rises, so past grants stay valid', () => {
    for (let n = 1; n <= top * 3; n++) {
      const before = new Set(owedRewards(referrer, kind, n - 1).map((r) => `${r.cycle}:${r.tier}`))
      const after = new Set(owedRewards(referrer, kind, n).map((r) => `${r.cycle}:${r.tier}`))
      for (const key of before) expect(after.has(key)).toBe(true)
    }
  })

  it('treats a negative count as zero rather than inventing a cycle', () => {
    const p = ladderProgress(referrer, kind, -3)
    expect(p.qualified).toBe(0)
    expect(p.cycle).toBe(1)
    expect(p.monthsEarned).toBe(0)
  })

  it('shows rungs as running totals that never go backwards', () => {
    let last = 0
    for (const tier of ladderProgress(referrer, kind, 0).tiers) {
      expect(tier.months).toBeGreaterThan(last)
      last = tier.months
    }
  })
})

describe('ladderProgress', () => {
  it('counts down to the next rung, showing the total it reaches', () => {
    expect(ladderProgress('coach', 'coach', 0).next).toEqual({ at: 3, months: 1, remaining: 3 })
    expect(ladderProgress('coach', 'coach', 7).next).toEqual({ at: 8, months: 3, remaining: 1 })
    expect(ladderProgress('club', 'club', 1).next).toEqual({ at: 2, months: 3, remaining: 1 })
    expect(ladderProgress('club', 'coach', 15).next).toEqual({ at: 16, months: 3, remaining: 1 })
  })

  it('rolls over to a fresh ladder after the top rung', () => {
    const p = ladderProgress('coach', 'club', 3)
    expect(p.cycle).toBe(2)
    expect(p.inCycle).toBe(0)
    expect(p.next).toEqual({ at: 1, months: 3, remaining: 1 })
    // The rewards are banked even though the new bar reads empty.
    expect(p.monthsEarned).toBe(12)
    expect(p.tiers.every((t) => !t.reached)).toBe(true)
  })

  it('marks rungs reached within the current pass only', () => {
    expect(ladderProgress('coach', 'coach', 8).tiers).toEqual([
      { at: 3, months: 1, reached: true },
      { at: 8, months: 3, reached: true },
      { at: 12, months: 12, reached: false },
    ])
  })
})
