// What each plan actually grants.
//
// This file is the pricing page, expressed as assertions. If the marketing
// copy and the product ever disagree, one of them changes and this fails —
// which is the whole reason the tiers live in one table instead of as
// `slug === 'pro'` scattered through the routes.

import { describe, it, expect } from 'vitest'
import {
  can, capabilitiesOf, isClubPlan, isPaidPlan, limitsFor,
  type Capability,
} from '../src/lib/capabilities.js'
import type { Entitlements } from '../src/lib/entitlements.js'

const ent = (slug: string | null, over: Partial<Entitlements> = {}): Entitlements => ({
  editorAccess: slug !== null,
  playerAccess: false,
  plan: slug ? { id: 1, name: slug, slug } : null,
  viaClub: false,
  viaPartner: false,
  isClubOwner: false,
  subscriptionStatus: slug ? 'active' : null,
  expiresAt: null,
  ...over,
})

describe('what Basic includes', () => {
  it('opens the editor', () => {
    expect(can(ent('basic'), 'editor')).toBe(true)
  })

  it('INCLUDES animation and video export', () => {
    // Deliberate, and the single most important line in this file. Animation
    // is why a coach tries the product; hiding it behind Pro would be selling
    // without the best argument. The upgrade is finish, not access.
    expect(can(ent('basic'), 'video_export')).toBe(true)
  })

  it('does not include HD, branding or extra squads', () => {
    const withheld: Capability[] = [
      'video_hd', 'own_branding', 'multi_squad',
      'social_export', 'guardian_copies', 'ai', 'publish_ebooks',
    ]
    for (const c of withheld) {
      expect(can(ent('basic'), c), `basic should not grant ${c}`).toBe(false)
    }
  })

  it('DOES include the planner and book drafting — because free does', () => {
    // Both moved down from Pro when the free tier was specified, and the
    // reason is the only one that matters: a paid tier cannot have less than
    // the free one. They are count limits here (12 sessions, 3 books), which
    // is a better wall anyway — "up to 12 sessions" is something a coach can
    // act on, where "no session builder" just sends them to a competitor.
    expect(can(ent('basic'), 'planner')).toBe(true)
    expect(can(ent('basic'), 'draft_ebooks')).toBe(true)
  })

  it('caps squads at one and video at ten a month', () => {
    expect(limitsFor(ent('basic'))).toMatchObject({ squads: 1, videoExports: 10 })
  })
})

describe('the free tier', () => {
  it('opens the editor and animates — the two things that sell the product', () => {
    // A free tier that cannot animate is a screenshot. Animation is why a
    // coach tries this at all, so it is the last thing to withhold.
    expect(can(ent('free'), 'editor')).toBe(true)
    expect(can(ent('free'), 'video_export')).toBe(true)
  })

  it('carries OUR brand, never the coach\'s', () => {
    // The trade: a free coach pays in marketing instead of money. Their own
    // badge, a public page and HD without our watermark are all things that
    // make them look professional to someone else, and all of them are Pro.
    expect(can(ent('free'), 'own_branding')).toBe(false)
    expect(can(ent('free'), 'video_hd')).toBe(false)
    expect(can(ent('free'), 'social_export')).toBe(false)
  })

  it('can write one book but never publish it', () => {
    // Deliberately not a locked button. A locked button teaches nobody what
    // the feature is; a finished draft with a publish step they cannot take
    // shows them exactly what they are missing, and leaves the work waiting
    // for the day they upgrade.
    expect(can(ent('free'), 'draft_ebooks')).toBe(true)
    expect(can(ent('free'), 'publish_ebooks')).toBe(false)
    expect(limitsFor(ent('free')).books).toBe(1)
  })

  it('counts everything the paid tiers do not', () => {
    expect(limitsFor(ent('free'))).toMatchObject({
      boards: 5, drillSheets: 5, books: 1, sessions: 1, squads: 1, videoExports: 3,
    })
  })

  it('is a strict subset of Basic, which is a strict subset of Pro', () => {
    // The rule that stops a pricing page becoming indefensible. It has been
    // broken twice already — free got the planner before Basic did, and free
    // got a book before Basic did — and both times the fix was to move the
    // feature DOWN, never to take it off free.
    for (const c of capabilitiesOf('free')) {
      expect(can(ent('basic'), c), `basic must keep ${c} that free has`).toBe(true)
    }
    for (const c of capabilitiesOf('basic')) {
      expect(can(ent('pro'), c), `pro must keep ${c} that basic has`).toBe(true)
    }
  })

  it('never counts fewer than free on any paid tier', () => {
    // The same rule for the numbers. A paid tier with a SMALLER cap than free
    // is the same failure as a missing feature, and much easier to miss.
    const free = limitsFor(ent('free'))
    for (const slug of ['basic', 'pro', 'club-5', 'club-10', 'club-20']) {
      const paid = limitsFor(ent(slug))
      for (const key of ['boards', 'drillSheets', 'books', 'sessions', 'squads', 'videoExports'] as const) {
        const freeN = free[key]
        const paidN = paid[key]
        if (paidN === null) continue // unlimited always wins
        expect(paidN, `${slug}.${key} (${paidN}) must be at least free's ${freeN}`)
          .toBeGreaterThanOrEqual(freeN ?? 0)
      }
    }
  })

  it('is not a paying customer', () => {
    expect(isPaidPlan('free')).toBe(false)
    expect(isPaidPlan('basic')).toBe(true)
    expect(isPaidPlan('pro')).toBe(true)
    expect(isPaidPlan('club-10')).toBe(true)
    expect(isPaidPlan(null)).toBe(false)
  })
})

describe('what Pro adds', () => {
  it('grants everything Basic does', () => {
    for (const c of capabilitiesOf('basic')) {
      expect(can(ent('pro'), c), `pro should keep ${c}`).toBe(true)
    }
  })

  it('unlocks HD, branding, the planner and unlimited squads', () => {
    for (const c of ['video_hd', 'own_branding', 'planner', 'multi_squad'] as Capability[]) {
      expect(can(ent('pro'), c)).toBe(true)
    }
    expect(limitsFor(ent('pro'))).toMatchObject({ squads: null, videoExports: null })
  })

  it('does NOT get the club page — that is a club plan, not a bigger coach', () => {
    expect(can(ent('pro'), 'club_page')).toBe(false)
  })

  it('is what a club seat grants, so club coaches are never second class', () => {
    // A coach on a club seat resolves through the club owner's plan. If that
    // gave them less than Pro, half a club would quietly be on a worse product
    // than a colleague paying for themselves.
    for (const c of capabilitiesOf('pro')) {
      expect(can(ent('club-5'), c), `a club seat should grant ${c}`).toBe(true)
    }
  })
})

describe('the club plans', () => {
  const SIZES = ['club-5', 'club-10', 'club-20'] as const

  it('give every seat the whole of Pro', () => {
    for (const slug of SIZES) {
      for (const c of capabilitiesOf('pro')) {
        expect(can(ent(slug), c), `${slug} should grant ${c}`).toBe(true)
      }
    }
  })

  it('differ ONLY by seats — never by features', () => {
    // The mistake this pins shut: the club tiers were once split by the club
    // page, so a five-coach club wanting one had to buy fifteen seats. Size
    // and features are independent questions, and only size is for sale.
    const sets = SIZES.map((slug) => [...capabilitiesOf(slug)].sort().join(','))
    expect(new Set(sets).size, 'every club size must grant the same features').toBe(1)

    expect(limitsFor(ent('club-5')).seats).toBe(5)
    expect(limitsFor(ent('club-10')).seats).toBe(10)
    expect(limitsFor(ent('club-20')).seats).toBe(20)
  })

  it('all include the club page, at every size', () => {
    // The smallest club is still a club. Withholding its own page to push it
    // up a size is selling a feature disguised as seats.
    for (const slug of SIZES) {
      expect(can(ent(slug), 'club_page'), `${slug} should have a club page`).toBe(true)
    }
  })

  it('are all recognised as club plans', () => {
    // Several places ask "is this a club?" to grant seats, show the club page
    // and attribute referral commission. Adding a size must never need those
    // touched again.
    for (const slug of [...SIZES, 'club', 'club-basic', 'club-pro']) {
      expect(isClubPlan(slug), `${slug} should count as a club plan`).toBe(true)
    }
    expect(isClubPlan('pro')).toBe(false)
    expect(isClubPlan('basic')).toBe(false)
    expect(isClubPlan(null)).toBe(false)
  })

  it('leaves the club page out of the individual coach plans', () => {
    expect(can(ent('pro'), 'club_page')).toBe(false)
    expect(can(ent('basic'), 'club_page')).toBe(false)
  })
})

describe('the edges that would quietly give the product away', () => {
  it('grants nothing without a plan', () => {
    expect(can(ent(null), 'editor')).toBe(false)
    expect(limitsFor(ent(null))).toMatchObject({ squads: 0, videoExports: 0 })
  })

  it('grants nothing once a subscription lapses, even though the plan remains', () => {
    // An expired subscription keeps its plan row. Reading capabilities off the
    // slug alone would leave a lapsed coach with everything their tier had.
    const lapsed = ent('pro', { editorAccess: false, subscriptionStatus: 'expired' })
    expect(can(lapsed, 'editor')).toBe(false)
    expect(can(lapsed, 'video_export')).toBe(false)
    expect(limitsFor(lapsed).videoExports).toBe(0)
  })

  it('gives a player account nothing to buy', () => {
    expect(capabilitiesOf('player')).toEqual([])
  })

  it('maps retired plans — including the short-lived club split — to a real tier', () => {
    // A slug resolving to zero capabilities is indistinguishable from an
    // expired subscription: the coach just finds the product empty. Nobody
    // holds these — nothing has launched — but seeded and hand-granted rows
    // outlive pricing decisions.
    expect(can(ent('pro-ai'), 'video_hd')).toBe(true)
    expect(can(ent('club'), 'club_page')).toBe(true)
    expect(can(ent('club-basic'), 'club_page')).toBe(true)
    expect(can(ent('club-pro'), 'club_page')).toBe(true)
  })

  it('refuses a capability for a slug it has never heard of', () => {
    expect(can(ent('enterprise-mega'), 'editor')).toBe(false)
  })
})
