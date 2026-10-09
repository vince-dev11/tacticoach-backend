// What a plan lets you do.
//
// Before this file there was one boolean — `editorAccess` — and every paid plan
// gave every feature. Two tiers cannot be expressed that way, and the tempting
// alternative (comparing `plan.slug === 'pro'` at each call site) is how pricing
// becomes impossible to change: the definition of a tier ends up scattered
// across thirty files, and moving one feature between tiers means finding all
// of them.
//
// So: ONE table, here. A route asks `can(ent, 'video_hd')`. Moving a feature
// between tiers is a one-line edit in this file, and the table itself is what
// the tests assert against — which means the pricing page and the product can
// be checked for agreement rather than hoped about.

import type { Entitlements } from './entitlements.js'

/** Everything a plan can gate. Named for the capability, never for the tier. */
export type Capability =
  /** Open the editor at all — the old `editorAccess`. */
  | 'editor'
  /** Export an animation as video. Both paid tiers; the QUALITY differs. */
  | 'video_export'
  /** Squad roster and written feedback to players. Paid plans only (1 Oct 2026). */
  | 'player_feedback'
  /** Export at HD rather than 720p, and without our watermark. */
  | 'video_hd'
  /** Square/story renders for social. */
  | 'social_export'
  /** Session builder and season planner. */
  | 'planner'
  /** More than one squad. */
  | 'multi_squad'
  /** The coach's own badge on sheets, shares and their public page. */
  | 'own_branding'
  /** Copies of session feedback to parents and guardians. */
  | 'guardian_copies'
  /** AI generation (also metered separately by credits). */
  | 'ai'
  /**
   * Write an ebook — open the authoring tools and save drafts.
   *
   * Split from publishing on purpose. A free coach gets one book they can
   * write but cannot publish, because the point of giving it away is that
   * they find out what the feature IS. A locked button teaches nobody
   * anything; a finished draft with a publish step they cannot take teaches
   * them exactly what they are missing, and leaves the work waiting for the
   * day they upgrade.
   */
  | 'draft_ebooks'
  /** Publish a book to the marketplace and sell it. The paid half. */
  | 'publish_ebooks'
  /** Club-wide: a public club page and shared library. */
  | 'club_page'
  /**
   * The 3D and Stadium views of a board, and their video (6 Oct 2026: Pro).
   * Rendered in the browser, so the gate is the UI's; the API's part is to
   * say who has it.
   */
  | 'board_3d'
  /** Ball sounds in downloaded videos (6 Oct 2026: Pro). */
  | 'ball_sound'
  /** Connected players — linked blocks with distances (6 Oct 2026: Pro). */
  | 'connected_players'

/**
 * The tiers, by plan slug.
 *
 * `basic` deliberately includes video_export. Animation is the reason coaches
 * try this product, and hiding it would mean selling without the best argument
 * — so the gate is finish (HD, no watermark, unlimited) rather than access.
 */
/**
 * Free: a 14-day trial (decided 1 Oct 2026), not a permanent tier.
 *
 * For fourteen days a coach gets the board with animation, three badged
 * videos, and small counts of boards, sheets, sessions, a season and a book
 * (see LIMITS.free). Squads and player feedback are paid. After the trial
 * the coach keeps read access to their work through the library and nothing
 * else — entitlements.ts closes the editor (editorAccess false), which every
 * write route already checks.
 *
 * What stays paid for good is what makes a coach look professional to
 * someone else: HD video, their own badge, a public page, publishing a book.
 */
/**
 * The trial is a taste of PRO, not of Basic (owner's decision, 6 Oct 2026).
 *
 * For its 14 days a coach gets Pro's look and finish — 3D and Stadium, ball
 * sounds, connected players, HD video without our badge, social export —
 * inside the trial's small counts (LIMITS.free). What stays out is what costs
 * us or moves money (AI credits, publishing a book) and what only matters to
 * a paying club or a coach with a following (own branding, squads, parents'
 * copies). A coach who then picks Basic loses the Pro-only parts, and that
 * is the point: they have seen them.
 *
 * This replaced "free ⊆ Basic". The rule that still holds, and is tested, is
 * free ⊆ Pro: nothing the trial shows is missing from the plan it advertises.
 */
const PRO_LOOK: Capability[] = ['board_3d', 'ball_sound', 'connected_players']

const FREE: Capability[] = [
  'editor', 'video_export', 'planner', 'draft_ebooks',
  'video_hd', 'social_export', ...PRO_LOOK,
]

/**
 * Basic keeps every WORKFLOW the free trial has (it was a superset of free
 * until 6 Oct 2026, when the trial became a taste of Pro — see FREE). Pro's
 * look and finish (3D, sounds, connected players, HD, social) are what a
 * Basic coach gives up; the tools to plan and run a session never are.
 *
 * Two features moved down here to keep that true, once free was specified:
 *
 *   planner — free builds one session, so a paying coach cannot have none.
 *   draft_ebooks — free writes one book, so the same.
 *
 * Both are now COUNT limits rather than capability gates (see LIMITS), which
 * is the better shape anyway: "the session builder, up to 12 sessions" is a
 * sentence a coach can act on, where "no session builder" just sends them
 * looking for a competitor who has one.
 */
const BASIC: Capability[] = ['editor', 'video_export', 'planner', 'draft_ebooks', 'player_feedback']

const PRO: Capability[] = [
  ...BASIC,
  'video_hd', 'social_export', 'multi_squad',
  'own_branding', 'guardian_copies', 'ai', 'publish_ebooks',
  ...PRO_LOOK,
]

/**
 * A club gets Pro for every seat, plus the club-wide extras. There is ONE club
 * feature set, not two.
 *
 * It was briefly split into Basic and Pro, and the split was a mistake worth
 * recording: the only thing dividing them was `club_page`, which meant a
 * five-coach club that wanted a club page had to buy fifteen seats — paying
 * £25 more for one feature, disguised as ten seats it would never use. Size
 * and features are independent questions, and a club can answer "how many
 * coaches do we have?" instantly while "do we want a club page?" needs a demo.
 * So size is the only thing a club chooses.
 */
const CLUB: Capability[] = [...PRO, 'club_page']

const BY_PLAN: Record<string, Capability[]> = {
  // Synthetic: nobody holds a `free` subscription row. It is what entitlements
  // resolve to when a coach has no active plan at all — see entitlements.ts.
  free: FREE,
  basic: BASIC,
  pro: PRO,
  // One feature set, three sizes.
  'club-5': CLUB,
  'club-10': CLUB,
  'club-20': CLUB,

  // ---- Legacy slugs -------------------------------------------------------
  // Nothing has launched, so nobody holds these. They stay mapped anyway
  // because seeded and hand-granted rows outlive pricing decisions, and a plan
  // slug that resolves to NO capabilities is indistinguishable from an expired
  // subscription — the user would simply find the product empty with no
  // explanation. Mapping them to the nearest current tier fails safe.
  'pro-ai': PRO,
  club: CLUB,
  'club-basic': CLUB,
  'club-pro': CLUB,
  player: [],

  // The company owner holds a synthetic plan and buys nothing.
  owner: [...CLUB],
}

/**
 * Per-plan limits. `null` means unlimited.
 *
 * Everything countable is here rather than gated in `Capability`, because a
 * count is a better wall than a switch: it lets a coach USE the feature, find
 * out it is good, and hit the edge of it with work already invested. A gated
 * feature is one they never try and therefore never miss.
 */
export interface PlanLimits {
  /** Squads a coach may keep. */
  squads: number | null
  /** Video exports per calendar month. */
  videoExports: number | null
  /** Saved tactics boards. */
  boards: number | null
  /** Saved drill sheets. */
  drillSheets: number | null
  /** Ebooks a coach may have. Free can write one but never publish it. */
  books: number | null
  /** Training sessions in the builder and planner. */
  sessions: number | null
  /** Season plans in the planner. */
  seasons: number | null
  /** Coach seats, for club plans. */
  seats: number | null
}

/** Paid tiers that count nothing. Spelled out so adding a field can't miss one. */
const UNCOUNTED = {
  squads: null, videoExports: null, boards: null,
  drillSheets: null, books: null, sessions: null, seasons: null,
} as const

const LIMITS: Record<string, PlanLimits> = {
  // Free: a 14-day trial (decided 1 Oct 2026). Small counts, counted by
  // CREATION rather than by rows kept — see lib/free-trial.ts. Animation and
  // three badged videos are in; squads (and so player feedback) are not.
  free: {
    squads: 0, videoExports: 3, boards: 3,
    drillSheets: 3, books: 1, sessions: 3, seasons: 1, seats: null,
  },
  basic: {
    squads: 1, videoExports: 10, boards: null,
    drillSheets: null, books: 3,
    // About a term. Enough that a coach plans a real block of work; short of
    // the full season the planner is built for.
    sessions: 12,
    seasons: null,
    seats: null,
  },
  pro: { ...UNCOUNTED, seats: null },
  'club-5': { ...UNCOUNTED, seats: 5 },
  'club-10': { ...UNCOUNTED, seats: 10 },
  'club-20': { ...UNCOUNTED, seats: 20 },
  'pro-ai': { ...UNCOUNTED, seats: null },
  club: { ...UNCOUNTED, seats: 10 },
  'club-basic': { ...UNCOUNTED, seats: 5 },
  'club-pro': { ...UNCOUNTED, seats: 15 },
  player: {
    squads: 0, videoExports: 0, boards: 0,
    drillSheets: 0, books: 0, sessions: 0, seasons: 0, seats: null,
  },
  owner: { ...UNCOUNTED, seats: null },
}

const UNRESTRICTED: PlanLimits = { ...UNCOUNTED, seats: null }
const NOTHING: PlanLimits = {
  squads: 0, videoExports: 0, boards: 0,
  drillSheets: 0, books: 0, sessions: 0, seasons: 0, seats: null,
}

/**
 * Can this person do this?
 *
 * Takes the whole Entitlements rather than a slug so that access granted by a
 * CLUB SEAT or a collaboration comp resolves the same way as an own subscription —
 * the caller should never have to remember which of the three it is.
 */
export function can(ent: Entitlements, capability: Capability): boolean {
  if (!ent.plan) return false
  // An expired or cancelled subscription keeps its plan row but grants nothing.
  // Without this check a lapsed coach would keep every capability their old
  // tier had, because the plan is still attached to the subscription.
  if (!ent.editorAccess) return false
  return (BY_PLAN[ent.plan.slug] ?? []).includes(capability)
}

/** The limits attached to this person's plan. */
export function limitsFor(ent: Entitlements): PlanLimits {
  if (!ent.plan || !ent.editorAccess) return NOTHING
  return LIMITS[ent.plan.slug] ?? UNRESTRICTED
}

/** Every capability a plan slug grants — for the pricing page and for tests. */
export function capabilitiesOf(slug: string): Capability[] {
  return BY_PLAN[slug] ?? []
}

/**
 * Everything this person can actually do right now.
 *
 * `capabilitiesOf` answers about a SLUG; this answers about a PERSON, which
 * means it also respects a lapsed subscription. It exists so the frontend can
 * be sent one list and ask `includes('video_hd')` instead of reimplementing
 * the tier table — the second copy of a pricing table is the one that goes
 * out of date.
 */
export function grantedCapabilities(ent: Entitlements): Capability[] {
  if (!ent.plan || !ent.editorAccess) return []
  return capabilitiesOf(ent.plan.slug)
}

/**
 * Is this a club plan — one that carries coach seats?
 *
 * Defined once, because four separate places used to ask `slug === 'club'` and
 * splitting Club into Basic and Pro would have silently broken every one of
 * them: club seats would stop granting access, the club page would vanish, and
 * referral commission would be attributed at the coach rate.
 */
export function isClubPlan(slug: string | null | undefined): boolean {
  return !!slug && (slug === 'club' || slug.startsWith('club-'))
}

/**
 * The plan a coach falls to when they have no subscription.
 *
 * Synthetic, like `owner`: there is no row and no `user_subscriptions` record,
 * because every coach who ever signs up would need one and none of them would
 * mean anything. It is not for sale, so it is not seeded as a purchasable
 * plan — `capabilitiesOf('free')` is the whole of it.
 */
export const FREE_PLAN = { id: 0, name: 'Free', slug: 'free' } as const

/**
 * Is this someone who actually pays us?
 *
 * Free and owner both carry a plan and full editor access, so `ent.plan` is no
 * longer the question "are they a customer?" — and several things care about
 * that rather than about capabilities: the referral ladder pays in free months
 * (meaningless to someone paying nothing), billing screens, and churn
 * reporting. Asking `!!ent.plan` in those places would quietly enrol every
 * free account.
 */
export function isPaidPlan(slug: string | null | undefined): boolean {
  return !!slug && slug !== 'free' && slug !== 'owner' && slug !== 'player'
}
