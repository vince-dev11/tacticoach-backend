import { db } from '../config/database.js'

/**
 * The plan a Partner is comped on. Declared here rather than in the partners
 * module so entitlements — which every request touches — doesn't have to pull
 * in the commission ledger to answer "can this person open the editor".
 */
export const PARTNER_PLAN_SLUG = 'pro'

export interface Entitlements {
  /** Can open the editor: own active subscription OR active club membership. */
  editorAccess: boolean
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

  return {
    editorAccess: ownActive || clubActive || (partnerActive && !!partnerPlan),
    plan,
    viaClub: !ownActive && clubActive,
    viaPartner: !ownActive && !clubActive && partnerActive && !!partnerPlan,
    isClubOwner: !!ownedClub && ownActive && sub!.plan.slug === 'club',
    subscriptionStatus: sub?.status ?? null,
    expiresAt: sub?.expiresAt ?? null,
  }
}
