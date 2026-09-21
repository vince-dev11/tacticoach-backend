// The plans as they reach the database, and as a customer reads them.
//
// `capabilities.test.ts` covers what each tier GRANTS. This covers what each
// tier SAYS and what it CHARGES — the seed row that becomes the price Stripe
// takes and the feature list shown on the billing screen. The two can disagree
// without anything failing, and they had: priority support was listed on
// Club 20 alone, so the club split we removed from the code was still alive in
// the copy, telling a five-coach club it was buying a lesser product.

import { describe, it, expect } from 'vitest'
import { SEED_PLANS } from '../prisma/plans.js'
import { capabilitiesOf, isClubPlan } from '../src/lib/capabilities.js'

const bySlug = (slug: string) => {
  const found = SEED_PLANS.find((p) => p.slug === slug)
  if (!found) throw new Error(`no seeded plan "${slug}"`)
  return found
}

const live = SEED_PLANS.filter((p) => p.isActive)
const CLUB_SIZES = ['club-5', 'club-10', 'club-20'] as const

describe('what is for sale', () => {
  it('is Basic, Pro and the three club sizes — nothing else', () => {
    expect(live.map((p) => p.slug).sort())
      .toEqual(['basic', 'club-10', 'club-20', 'club-5', 'pro'])
  })

  it('keeps every retired plan as an inactive row rather than deleting it', () => {
    // Deleting would orphan any subscription pointing at it. Inactive closes
    // the sale — GET /plans filters on it and checkout refuses one — while
    // the relation stays valid.
    for (const slug of ['club', 'club-basic', 'club-pro', 'pro-ai', 'player']) {
      expect(bySlug(slug).isActive, `${slug} should be retired, not deleted`).toBe(false)
    }
  })

  it('gives every live plan a price for both billing cycles', () => {
    // Checkout 422s on a missing price. A plan that cannot be bought on the
    // cycle the toggle is showing is a dead button on the pricing page.
    for (const p of live) {
      expect(Number(p.monthlyPrice), `${p.slug} monthly`).toBeGreaterThan(0)
      expect(Number(p.annualPrice), `${p.slug} annual`).toBeGreaterThan(0)
    }
  })

  it('makes a year up front cheaper than twelve months, everywhere', () => {
    for (const p of live) {
      expect(Number(p.annualPrice), `${p.slug}: £${p.annualPrice}/yr vs £${p.monthlyPrice}×12`)
        .toBeLessThan(Number(p.monthlyPrice) * 12)
    }
  })

  it('prices every plan in one currency', () => {
    expect(new Set(live.map((p) => p.currency))).toEqual(new Set(['GBP']))
  })

  it('sorts the live plans cheapest first', () => {
    // sortOrder drives the billing screen. Out of order, the cheapest plan
    // appears in the middle of the list for no reason a reader can see.
    const ordered = [...live].sort((a, b) => a.sortOrder - b.sortOrder)
    const prices = ordered.map((p) => Number(p.monthlyPrice))
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })
})

describe('Basic and Pro', () => {
  it('says animation and video export are IN Basic', () => {
    // Matches the capability table, and it has to be said on the card: a
    // Basic tier that looks like it cannot animate is a Basic tier nobody
    // buys and a trial nobody converts.
    const line = bySlug('basic').features.find((f) => /animation/i.test(f))
    expect(line, 'Basic must advertise animation').toBeTruthy()
    expect(line).toMatch(/video/i)
  })

  it('names the Basic caps on the Basic card', () => {
    // A coach who discovers the ten-a-month limit after paying was misled by
    // a page that was technically accurate.
    const text = bySlug('basic').features.join(' · ')
    expect(text, 'the video cap should be visible').toMatch(/10 a month/)
    expect(text, 'the squad cap should be visible').toMatch(/one squad/i)
  })

  it('gives Pro a seat count of one — it is a coach, not a club', () => {
    expect(bySlug('pro').maxTeamMembers).toBe(1)
  })
})

describe('the three club sizes', () => {
  const sizes = CLUB_SIZES.map(bySlug)

  it('seats 5, 10 and 20', () => {
    expect(sizes.map((p) => p.maxTeamMembers)).toEqual([5, 10, 20])
  })

  it('advertises exactly the same things apart from the seat count', () => {
    // The test that would have caught the drift. Feature copy is where a
    // retired tier split comes back: nothing in the code enforces it, and a
    // line quietly added to the biggest size reads to a small club as "you
    // are buying the cut-down one".
    const withoutSeats = sizes.map((p) =>
      p.features.filter((f) => !/coach seats/i.test(f)).join(' | '),
    )
    expect(new Set(withoutSeats).size,
      `club sizes advertise different features:\n${withoutSeats.join('\n')}`).toBe(1)
  })

  it('states its own seat count, once, on each card', () => {
    for (const p of sizes) {
      const seatLines = p.features.filter((f) => /coach seats/i.test(f))
      expect(seatLines, `${p.slug} seat lines`).toHaveLength(1)
      expect(seatLines[0]).toContain(String(p.maxTeamMembers))
    }
  })

  it('gets cheaper per coach as it gets bigger', () => {
    // The only reason to buy the larger size. Inverted, the page would be
    // charging a twenty-coach club a premium for being large.
    const perSeat = sizes.map((p) => Number(p.monthlyPrice) / (p.maxTeamMembers ?? 1))
    for (let i = 1; i < perSeat.length; i++) {
      expect(perSeat[i], `${sizes[i].slug} (£${perSeat[i].toFixed(2)}/coach) must beat ${sizes[i - 1].slug} (£${perSeat[i - 1].toFixed(2)})`)
        .toBeLessThan(perSeat[i - 1])
    }
  })

  it('beats individual Pro per coach at every size', () => {
    // A club seat costing more than the coach could pay alone would make the
    // club plan a punishment for organising.
    const pro = Number(bySlug('pro').monthlyPrice)
    for (const p of sizes) {
      const per = Number(p.monthlyPrice) / (p.maxTeamMembers ?? 1)
      expect(per, `${p.slug} at £${per.toFixed(2)}/coach vs Pro at £${pro}`).toBeLessThan(pro)
    }
  })

  it('grants the club page at every size, matching the capability table', () => {
    for (const p of sizes) {
      expect(isClubPlan(p.slug)).toBe(true)
      expect(capabilitiesOf(p.slug)).toContain('club_page')
    }
  })
})

describe('the seed and the capability table agree', () => {
  it('knows every plan it seeds', () => {
    // A seeded slug the capability table has never heard of grants nothing.
    // The coach would find the product empty with no explanation, and the
    // only clue would be a slug mismatch nobody was looking for.
    for (const p of SEED_PLANS) {
      if (p.slug === 'player') continue // deliberately empty
      expect(capabilitiesOf(p.slug).length, `${p.slug} resolves to no capabilities`)
        .toBeGreaterThan(0)
    }
  })

  it('seeds a plan for every slug the capability table lists', () => {
    // The other direction: a tier that exists in code but was never seeded
    // cannot be bought, and nothing else would say so.
    const seeded = new Set(SEED_PLANS.map((p) => p.slug))
    for (const slug of [...CLUB_SIZES, 'basic', 'pro']) {
      expect(seeded.has(slug), `${slug} is in the capability table but not seeded`).toBe(true)
    }
  })
})
