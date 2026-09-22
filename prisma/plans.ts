// The plans we sell, as data.
//
// Lifted out of seed.ts so it can be asserted on. Seeding is a script that
// runs once and prints a tick; nothing was checking that the three club sizes
// advertise the same things, and they had already drifted — priority support
// was listed on Club 20 alone, which is the club split quietly growing back
// in the marketing copy after being removed from the code.
//
// Prices here are what Stripe charges: checkout reads this table by slug
// (see membership.routes.ts), so these are the authority and the landing
// page's copy in the frontend repo follows them. See
// TACTICAL_COACH/Pricing_2026-09-20.md for both halves in one place.

export interface SeedPlan {
  name: string
  slug: string
  description: string
  monthlyPrice: string
  annualPrice: string
  currency: string
  features: string[]
  maxBoards: number | null
  maxTeamMembers: number | null
  isActive: boolean
  sortOrder: number
}

export const SEED_PLANS: SeedPlan[] = [
  {
    name: 'Basic',
    slug: 'basic',
    description: 'One team. Everything you need for a weekly session.',
    monthlyPrice: '4.99',
    annualPrice: '45.00', // 3 months free (£3.75/mo billed yearly)
    currency: 'GBP',
    // Animation and video are DELIBERATELY here and not held back for Pro:
    // they are why a coach tries this product at all, and selling without
    // them means selling without the best argument. The upgrade is finish —
    // HD, no watermark, no monthly cap — not access. See lib/capabilities.
    features: [
      'Tactics board — every pitch and all equipment',
      'Unlimited saved boards',
      'Animation + video export (720p, 10 a month)',
      'Drill sheets with PDF export',
      'Session builder, up to 12 sessions',
      'Write up to 3 books',
      'One squad',
      'Session feedback to players',
    ],
    maxBoards: null,
    maxTeamMembers: 1,
    isActive: true,
    sortOrder: 1,
  },
  {
    name: 'Pro',
    slug: 'pro',
    description: 'Several teams, or a coach building a name.',
    monthlyPrice: '8.99',
    annualPrice: '79.00', // 3 months free (£6.58/mo billed yearly)
    currency: 'GBP',
    features: [
      'Everything in Basic',
      'HD video, unlimited, with your badge',
      'Social and reel export',
      'Unlimited sessions + the season planner',
      'Publish and sell your books',
      'Unlimited squads',
      'Parent and guardian copies',
      'AI credits',
    ],
    maxBoards: null,
    maxTeamMembers: 1,
    isActive: true,
    sortOrder: 2,
  },
  {
    // ONE club feature set, three sizes.
    //
    // It was briefly Club Basic and Club Pro, split by the club page alone.
    // That forced a five-coach club wanting a club page to buy fifteen seats
    // — £25 more for one feature, dressed up as ten seats it would never
    // use. Size and features are independent questions; only size is one a
    // chairman can answer without a demo, so only size is for sale.
    // Priority support is listed at EVERY size, not just the largest. It
    // was on Club 20 alone, which is the club split quietly growing back:
    // a benefit withheld from smaller clubs to make the bigger size look
    // better. Sizes differ by seats. That is the whole rule.
    name: 'Club 5',
    slug: 'club-5',
    description: 'Up to 5 coaches. Everything, for every seat.',
    monthlyPrice: '24.99',
    // Exactly ten times the monthly, NOT the nine-times "3 months free" the
    // coach plans get. That is deliberate and load-bearing: the referral
    // programme pays one free month per club referred, and a free month has
    // to come in under 10% of the referred club's first year. At £249 it was
    // 10.04% — over by nine pence — and the reward had to halve to "1 per 2".
    // The extra pound buys the better sentence. See lib/referral-ladder.
    annualPrice: '250.00', // £4.17 per coach per month billed annually
    currency: 'GBP',
    features: [
      'Everything in Pro, for every coach',
      '5 coach seats',
      'Shared board library',
      'Public club page and branding',
      'Priority support',
    ],
    maxBoards: null,
    maxTeamMembers: 5,
    isActive: true,
    sortOrder: 3,
  },
  {
    name: 'Club 10',
    slug: 'club-10',
    description: 'Up to 10 coaches. Everything, for every seat.',
    monthlyPrice: '39.99',
    annualPrice: '400.00', // £3.33 per coach per month billed annually — ten times monthly, see Club 5
    currency: 'GBP',
    features: [
      'Everything in Pro, for every coach',
      '10 coach seats',
      'Shared board library',
      'Public club page and branding',
      'Priority support',
    ],
    maxBoards: null,
    maxTeamMembers: 10,
    isActive: true,
    sortOrder: 4,
  },
  {
    name: 'Club 20',
    slug: 'club-20',
    description: 'Up to 20 coaches. Everything, for every seat.',
    monthlyPrice: '69.99',
    annualPrice: '700.00', // £2.92 per coach per month billed annually — ten times monthly, see Club 5
    currency: 'GBP',
    features: [
      'Everything in Pro, for every coach',
      '20 coach seats',
      'Shared board library',
      'Public club page and branding',
      'Priority support',
    ],
    maxBoards: null,
    maxTeamMembers: 20,
    isActive: true,
    sortOrder: 5,
  },
  {
    // RETIRED, like the player plan below. Kept as a row rather than deleted
    // so any historic subscription still resolves to a real plan; isActive
    // false is what closes the sale, because GET /plans filters on it.
    name: 'Club',
    slug: 'club',
    description: 'Replaced by Club Basic and Club Pro.',
    monthlyPrice: '24.99',
    annualPrice: '249.00',
    currency: 'GBP',
    features: [],
    maxBoards: null,
    maxTeamMembers: 10,
    isActive: false,
    sortOrder: 90,
  },
  {
    // RETIRED before it ever shipped — the club tiers were split by the club
    // page alone, which priced small clubs out of a feature rather than out
    // of seats. capabilities.ts still maps both to the club set.
    name: 'Club Basic',
    slug: 'club-basic',
    description: 'Replaced by Club, sized by seats.',
    monthlyPrice: '24.99',
    annualPrice: '249.00',
    currency: 'GBP',
    features: [],
    maxBoards: null,
    maxTeamMembers: 5,
    isActive: false,
    sortOrder: 92,
  },
  {
    name: 'Club Pro',
    slug: 'club-pro',
    description: 'Replaced by Club, sized by seats.',
    monthlyPrice: '49.99',
    annualPrice: '499.00',
    currency: 'GBP',
    features: [],
    maxBoards: null,
    maxTeamMembers: 15,
    isActive: false,
    sortOrder: 93,
  },
  {
    // RETIRED with the old two-tier pricing. capabilities.ts maps it to Pro
    // so anyone holding one is never left with an empty product.
    name: 'Pro + AI',
    slug: 'pro-ai',
    description: 'Replaced by Pro.',
    monthlyPrice: '5.99',
    annualPrice: '59.99',
    currency: 'GBP',
    features: [],
    maxBoards: null,
    maxTeamMembers: 1,
    isActive: false,
    sortOrder: 91,
  },
  {
    // RETIRED. Players are free and always will be — see the comment on
    // playerAccess in lib/entitlements.
    //
    // Why it was wrong to sell: a player's value is produced by their coach.
    // Charging the player for words somebody else has to write puts a paywall
    // between us and the only organic distribution we have — every connected
    // player is a coach-shaped hole at their next club. It also made the
    // cheapest plan the most expensive to serve: ~22% of £2.99 goes in card
    // fees, against ~8% on an annual coach plan, and players outnumber
    // coaches roughly 20:1.
    //
    // Kept as a row rather than deleted. Anyone who did subscribe keeps a
    // valid plan relation and runs to the end of what they paid for;
    // isActive:false is enough to close the sale, because GET /plans filters
    // on it and POST /membership/checkout refuses an inactive plan. Deleting
    // the row would orphan those subscriptions.
    //
    // The upsert below writes isActive on EXISTING rows too, so re-seeding
    // production is what actually retires it.
    name: 'Player',
    slug: 'player',
    description: 'Retired — players are free. Kept so historic subscriptions still resolve.',
    // Left at what it actually cost. A historic subscriber's billing screen
    // reads its price from this row, and showing them £0.00 for something
    // Stripe is still charging them £2.99 for would be a lie.
    monthlyPrice: '2.99',
    annualPrice: '29.00',
    currency: 'GBP',
    features: [],
    maxBoards: 0,
    maxTeamMembers: 0,
    isActive: false,
    sortOrder: 4,
  },
]
