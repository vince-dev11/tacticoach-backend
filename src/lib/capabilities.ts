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
 * The tiers, by plan slug.
 *
 * `basic` deliberately includes video_export. Animation is the reason coaches
 * try this product, and hiding it would mean selling without the best argument
 * — so the gate is finish (HD, no watermark, unlimited) rather than access.
 */
/**
 * Free, forever, for a coach who never pays.
 *
 * Not a trial and not a crippled demo — a real, permanent account, because the
 * players are the distribution and the players arrive through a coach. A coach
 * who hits a wall on day 8 and leaves takes eighteen players with them, and
 * those players were the only free channel we have.
 *
 * So the free tier is shaped to keep the loop alive rather than to be
 * annoying: the whole board, real animation, video export (watermarked), and
 * writing to players — all of it unlimited in KIND and limited in COUNT. Five
 * boards is a fortnight of work for a real coach, which is long enough to
 * build a habit and short enough to matter.
 *
 * What it deliberately does not include is everything that makes a coach look
 * professional to someone else: HD video, their own badge, a public page,
 * publishing a book. Free coaches carry OUR brand. That is the trade, and it
 * is the honest one — they are paying in marketing instead of money.
 */
const FREE: Capability[] = ['editor', 'video_export', 'planner', 'draft_ebooks']

/**
 * Basic must be a SUPERSET of free. Every one of these tiers is, and that is
 * not a style rule — a paid tier missing something the free tier has is
 * indefensible on a pricing page and impossible to explain on a support call.
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
const BASIC: Capability[] = ['editor', 'video_export', 'planner', 'draft_ebooks']

const PRO: Capability[] = [
  ...BASIC,
  'video_hd', 'social_export', 'multi_squad',
  'own_branding', 'guardian_copies', 'ai', 'publish_ebooks',
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
  /** Coach seats, for club plans. */
  seats: number | null
}

/** Paid tiers that count nothing. Spelled out so adding a field can't miss one. */
const UNCOUNTED = {
  squads: null, videoExports: null, boards: null,
  drillSheets: null, books: null, sessions: null,
} as const

const LIMITS: Record<string, PlanLimits> = {
  // Free. Generous in kind, small in number — see FREE above.
  //
  // The numbers are chosen to be a fortnight of real work, not a demo: five
  // boards and five drill sheets is a couple of weeks of sessions, and a coach
  // who has filled them has already built the habit we want to charge for.
  // Three videos a month is enough to post one a week and run out, which is
  // the moment Basic sells itself.
  free: {
    squads: 1, videoExports: 3, boards: 5,
    drillSheets: 5, books: 1, sessions: 1, seats: null,
  },
  basic: {
    squads: 1, videoExports: 10, boards: null,
    drillSheets: null, books: 3,
    // About a term. Enough that a coach plans a real block of work; short of
    // the full season the planner is built for.
    sessions: 12,
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
    drillSheets: 0, books: 0, sessions: 0, seats: null,
  },
  owner: { ...UNCOUNTED, seats: null },
}

const UNRESTRICTED: PlanLimits = { ...UNCOUNTED, seats: null }
const NOTHING: PlanLimits = {
  squads: 0, videoExports: 0, boards: 0,
  drillSheets: 0, books: 0, sessions: 0, seats: null,
}

/**
 * Can this person do this?
 *
 * Takes the whole Entitlements rather than a slug so that access granted by a
 * CLUB SEAT or a partner comp resolves the same way as an own subscription —
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
