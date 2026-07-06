import { db } from '../config/database.js'

export interface Entitlements {
  /** Can open the editor: own active subscription OR active club membership. */
  editorAccess: boolean
  /** The plan granting access (own plan, or the club owner's plan via a seat). */
  plan: { id: number; name: string; slug: string } | null
  /** Access comes through a club seat rather than the user's own subscription. */
  viaClub: boolean
  /** The user owns a club (active club plan). */
  isClubOwner: boolean
  subscriptionStatus: string | null
  expiresAt: Date | null
}

function subIsActive(sub: { status: string; expiresAt: Date | null } | null | undefined): boolean {
  if (!sub) return false
  if (sub.status !== 'active' && sub.status !== 'trial') return false
  return !sub.expiresAt || sub.expiresAt > new Date()
}

/**
 * Compute what the user can access. Editor access is granted by:
 *   1. their own active/trial subscription, or
 *   2. a club seat — membership in a club whose OWNER has an active club-plan
 *      subscription.
 */
export async function getEntitlements(userId: number): Promise<Entitlements> {
  const [sub, membership, ownedClub] = await Promise.all([
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
  ])

  const ownActive = subIsActive(sub)
  const ownerSub = membership?.club.owner.subscription ?? null
  const clubActive = subIsActive(ownerSub) && ownerSub?.plan.slug === 'club'

  const plan = ownActive ? sub!.plan : clubActive ? ownerSub!.plan : null

  return {
    editorAccess: ownActive || clubActive,
    plan,
    viaClub: !ownActive && clubActive,
    isClubOwner: !!ownedClub && ownActive && sub!.plan.slug === 'club',
    subscriptionStatus: sub?.status ?? null,
    expiresAt: sub?.expiresAt ?? null,
  }
}
