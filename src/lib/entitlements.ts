import { db } from '../config/database.js'

/**
 * The plan a Partner is comped on. Declared here rather than in the partners
 * module so entitlements — which every request touches — doesn't have to pull
 * in the commission ledger to answer "can this person open the editor".
 */
export const PARTNER_PLAN_SLUG = 'pro'

/**
 * The plan a player buys for themselves.
 *
 * It is an ACTIVE subscription that must grant no authoring whatsoever, which
 * is why `playerAccess` exists as a separate flag rather than something clever
 * read off `editorAccess`. Every gated route in the app hangs off
 * `editorAccess`; none of them change behaviour because of this file.
 */
export const PLAYER_PLAN_SLUG = 'player'

export interface Entitlements {
  /** Can open the editor: own active subscription OR active club membership. */
  editorAccess: boolean
  /**
   * Can open the player's own screens — this week, my season, the read-only
   * board viewer. True for an active player subscription, and for anyone a
   * coach has linked to a squad (a player whose club pays for them should not
   * lose their feedback because their own card expired).
   */
  playerAccess: boolean
  /** The plan granting access (own plan, or the club owner's plan via a seat). */
  plan: { id: number; name: string; slug: string } | null
  /** Access comes through a club seat rather than the user's own subscription. */
  viaClub: boolean
  /** Access is comped because the user is an active Partner, not a customer. */
  viaPartner: boolean
  /** The user owns a club (active club plan). */
  isClubOwner: boolean
  subscriptionStatus: string | null
  expiresAt: Date | null
}

export function subIsActive(sub: { status: string; expiresAt: Date | null } | null | undefined): boolean {
  if (!sub) return false
  if (sub.status !== 'active' && sub.status !== 'trial') return false
  return !sub.expiresAt || sub.expiresAt > new Date()
}

/**
 * Whether a club's branding may be shown publicly: the club OWNER must hold an
 * active subscription. The moment the owner stops paying, the public club page
 * and all branded share strips disappear — and come back automatically on
 * renewal (approval status is untouched).
 */
export async function clubBrandingActive(ownerId: number): Promise<boolean> {
  const sub = await db.userSubscription.findUnique({
    where: { userId: ownerId },
    select: { status: true, expiresAt: true },
  })
  return subIsActive(sub)
}

/**
 * Compute what the user can access. Editor access is granted by:
 *   1. their own active/trial subscription, or
 *   2. a club seat — membership in a club whose OWNER has an active club-plan
 *      subscription.
 */
export async function getEntitlements(userId: number): Promise<Entitlements> {
  // The company owner (admin) never buys a plan — full access, no trial nags.
  const account = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (account?.role === 'owner') {
    return {
      editorAccess: true,
      playerAccess: false,
      plan: { id: 0, name: 'Owner', slug: 'owner' },
      viaClub: false,
      viaPartner: false,
      isClubOwner: false,
      subscriptionStatus: 'active',
      expiresAt: null,
    }
  }

  const [sub, membership, ownedClub, partner] = await Promise.all([
    db.userSubscription.findUnique({
      where: { userId },
      include: { plan: { select: { id: true, name: true, slug: true } } },
    }),
    db.clubMember.findUnique({
      where: { userId },
      include: {
        club: {
          include: {
            owner: {
              select: {
                subscription: {
                  include: { plan: { select: { id: true, name: true, slug: true } } },
                },
              },
            },
          },
        },
      },
    }),
    db.club.findUnique({ where: { ownerId: userId }, select: { id: true } }),
    db.partner.findUnique({ where: { userId }, select: { status: true } }),
  ])

  // Linked to at least one coach's squad. Checked separately from the plan so
  // a player keeps their history if their subscription lapses — the notes are
  // theirs, not something they rent.
  const linkedToSquad = await db.squadPlayer.findFirst({
    where: { playerUserId: userId, linkStatus: 'active', archivedAt: null },
    select: { id: true },
  })

  const ownActive = subIsActive(sub)
  const ownerSub = membership?.club.owner.subscription ?? null
  const clubActive = subIsActive(ownerSub) && ownerSub?.plan.slug === 'club'

  // A partner is a supplier, not a customer: they are paid commission and given
  // the product to sell, so access cannot be conditional on them buying it.
  // Checked last, so a partner who ALSO pays keeps their own plan — someone on
  // Club must not be silently downgraded to Pro by signing a partner agreement.
  const partnerActive = partner?.status === 'active'
  const partnerPlan =
    partnerActive && !ownActive && !clubActive
      ? await db.membershipPlan.findUnique({
          where: { slug: PARTNER_PLAN_SLUG },
          select: { id: true, name: true, slug: true },
        })
      : null

  const plan = ownActive ? sub!.plan : clubActive ? ownerSub!.plan : partnerPlan

  // A player subscription is active but authors nothing. Excluded here rather
  // than anywhere else, so every existing `requireEditorAccess` route refuses
  // a player with no change of its own.
  // `sub?.plan?.slug`, not `sub!.plan.slug`: a subscription whose plan row has
  // gone (deleted, or a partially-seeded database) must degrade to "no player
  // plan" rather than throw and take every entitlement check down with it.
  const isPlayerPlan = ownActive && sub?.plan?.slug === PLAYER_PLAN_SLUG

  return {
    editorAccess:
      (ownActive && !isPlayerPlan) || clubActive || (partnerActive && !!partnerPlan),
    playerAccess: isPlayerPlan || !!linkedToSquad,
    plan,
    viaClub: !ownActive && clubActive,
    viaPartner: !ownActive && !clubActive && partnerActive && !!partnerPlan,
    isClubOwner: !!ownedClub && ownActive && sub?.plan?.slug === 'club',
    subscriptionStatus: sub?.status ?? null,
    expiresAt: sub?.expiresAt ?? null,
  }
}
