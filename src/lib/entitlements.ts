import { db } from '../config/database.js'
import { isClubPlan, FREE_PLAN } from './capabilities.js'
import { freeTrialActive } from './free-trial.js'

/**
 * The plan a Collaborator is comped on. Declared here rather than in the
 * module so entitlements — which every request touches — doesn't have to pull
 * in the commission ledger to answer "can this person open the editor".
 */
export const COLLABORATION_PLAN_SLUG = 'pro'

export interface Entitlements {
  /**
   * May open the editor at all — create or change anything. True for a paid
   * plan, a club seat, a collaborator, and a coach inside the 14-day free
   * trial; false for players and for a coach whose free trial has ended
   * (who keeps read access to the library, see `subscriptionStatus`).
   *
   * It is NOT "is a paying customer" — it used to be, and the rename never
   * happened. Ask `isPaidPlan(ent.plan?.slug)` for that, or `can()` for what
   * they may actually do.
   */
  editorAccess: boolean
  /**
   * Can open the player's own screens — this week, my season, the read-only
   * board viewer.
   *
   * FREE, and deliberately so. There is no player plan any more; prisma/seed
   * carries the reasoning. This is true for anyone a coach has linked to a
   * squad and false for everyone else, which makes it not an entitlement in
   * the billing sense at all — it is "is this person somebody's player?", and
   * no subscription changes the answer.
   *
   * The flag stays because the question is still worth asking: the player
   * screens are useless to a coach and the coach screens are useless to a
   * player, so something has to decide where a login lands.
   */
  playerAccess: boolean
  /** The plan granting access (own plan, or the club owner's plan via a seat). */
  plan: { id: number; name: string; slug: string } | null
  /** Access comes through a club seat rather than the user's own subscription. */
  viaClub: boolean
  /** Access is comped because the user is an active Collaborator, not a customer. */
  viaCollaboration: boolean
  /** The user owns a club (active club plan). */
  isClubOwner: boolean
  /**
   * The subscription's own status for paid access; for the free plan,
   * `'free_trial'` inside the 14 days and `'free_expired'` after them.
   */
  subscriptionStatus: string | null
  expiresAt: Date | null
  /** End of the free trial — set only when access is the free plan. */
  trialEndsAt: Date | null
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
  const account = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, accountType: true, freeTrialEndsAt: true },
  })

  // A player account never authors, whatever it holds.
  //
  // Checked FIRST, above the owner branch and above any subscription, because
  // every other path here can hand out editorAccess and this one must win over
  // all of them. The case that made it necessary: register gives every new
  // account a 14-day full-access trial, so for its first week a player account
  // carried an active trial subscription and `ownActive` was true. A child who
  // ticked "I'm a player" got the whole coach product for seven days and then
  // a "your trial has ended, choose a plan" wall for something they never
  // wanted. Nothing is for sale here — see middleware/player-guard.
  if (account?.accountType === 'player') {
    const linked = await db.squadPlayer.findFirst({
      where: { playerUserId: userId, linkStatus: 'active', archivedAt: null },
      select: { id: true },
    })
    return {
      editorAccess: false,
      playerAccess: !!linked,
      plan: null,
      viaClub: false,
      viaCollaboration: false,
      isClubOwner: false,
      subscriptionStatus: null,
      expiresAt: null,
      trialEndsAt: null,
    }
  }

  // The company owner (admin) never buys a plan — full access, no trial nags.
  if (account?.role === 'owner') {
    return {
      editorAccess: true,
      playerAccess: false,
      plan: { id: 0, name: 'Owner', slug: 'owner' },
      viaClub: false,
      viaCollaboration: false,
      isClubOwner: false,
      subscriptionStatus: 'active',
      expiresAt: null,
      trialEndsAt: null,
    }
  }

  const [sub, membership, ownedClub, collaborator] = await Promise.all([
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
    db.collaborator.findUnique({ where: { userId }, select: { status: true } }),
  ])

  // Linked to at least one coach's squad. This is the WHOLE of playerAccess:
  // a player's record is theirs, not something they rent.
  const linkedToSquad = await db.squadPlayer.findFirst({
    where: { playerUserId: userId, linkStatus: 'active', archivedAt: null },
    select: { id: true },
  })

  const ownActive = subIsActive(sub)
  const ownerSub = membership?.club.owner.subscription ?? null
  const clubActive = subIsActive(ownerSub) && isClubPlan(ownerSub?.plan.slug)

  // A collaborator is a supplier, not a customer: they are paid commission and given
  // the product to sell, so access cannot be conditional on them buying it.
  // Checked last, so a collaborator who ALSO pays keeps their own plan — someone on
  // Club must not be silently downgraded to Pro by signing a collaboration agreement.
  const collaborationActive = collaborator?.status === 'active'
  const collaborationPlan =
    collaborationActive && !ownActive && !clubActive
      ? await db.membershipPlan.findUnique({
          where: { slug: COLLABORATION_PLAN_SLUG },
          select: { id: true, name: true, slug: true },
        })
      : null

  // Nothing active anywhere → the free plan, which is a 14-day trial
  // (decided 1 Oct 2026). Inside the window the coach may author within the
  // free limits; after it the account keeps the free plan's identity (so the
  // UI can say "your trial has ended") but editorAccess is false, which
  // closes every write route while every read route — the library — stays
  // open. `free` is synthetic: no subscription row exists for it.
  //
  // The retired player plan is not special-cased out. Anyone still holding one
  // paid for a plan that granted the full product, and they keep it until it
  // expires.
  const paidPlan = ownActive ? sub!.plan : clubActive ? ownerSub!.plan : collaborationPlan
  const inFreeTrial = !paidPlan && freeTrialActive(account?.freeTrialEndsAt ?? null)
  const plan = paidPlan ?? { ...FREE_PLAN }

  return {
    editorAccess: !!paidPlan || inFreeTrial,
    playerAccess: !!linkedToSquad,
    plan,
    viaClub: !ownActive && clubActive,
    viaCollaboration: !ownActive && !clubActive && collaborationActive && !!collaborationPlan,
    isClubOwner: !!ownedClub && ownActive && isClubPlan(sub?.plan?.slug),
    subscriptionStatus: paidPlan ? (sub?.status ?? null) : inFreeTrial ? 'free_trial' : 'free_expired',
    expiresAt: paidPlan ? (sub?.expiresAt ?? null) : null,
    trialEndsAt: paidPlan ? null : (account?.freeTrialEndsAt ?? null),
  }
}
