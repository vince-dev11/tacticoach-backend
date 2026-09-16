// Who may act for whom inside a club.
//
// Everywhere else in the app, "whose is this?" is answered by one integer: the
// row's userId must equal the caller's. That is still the rule — this module
// only ever WIDENS it, and only for a club admin, and only to other coaches in
// the same club.
//
// Three things are deliberately true here:
//
//   1. The club OWNER has no `club_members` row. `clubs.routes` creates member
//      rows from accepted invites only, so the owner is never a member of
//      their own club. Ownership is read from `clubs.owner_id` and is admin
//      implicitly. Anything that looks for club staff via `clubMember` alone
//      silently misses the one person who pays for it.
//
//   2. Admin powers require the club plan to be ACTIVE. A club that stops
//      paying loses cross-squad access the same day it loses everything else;
//      it must not leave a director quietly holding the keys to twenty
//      coaches' players.
//
//   3. Nothing here grants editor access. A member still needs their seat to
//      resolve through lib/entitlements. This answers a narrower question:
//      given that you are allowed in, whose work may you touch?

import { db } from '../config/database.js'
import { subIsActive } from './entitlements.js'

export const CLUB_PLAN_SLUG = 'club'

export interface ClubStanding {
  clubId: number
  /** May act for every coach in the club. Owner, or a member the owner promoted. */
  isAdmin: boolean
  /** True for the club owner specifically — only they can promote anyone. */
  isOwner: boolean
}

/**
 * The club this user belongs to and what they are within it, or null.
 *
 * Ownership is checked first: someone who owns a club and also holds a seat in
 * another one is answered as the owner, because that is the club whose money
 * and liability are theirs.
 */
export async function clubStandingFor(userId: number): Promise<ClubStanding | null> {
  const owned = await db.club.findUnique({ where: { ownerId: userId }, select: { id: true } })
  if (owned) {
    const sub = await db.userSubscription.findUnique({
      where: { userId },
      select: { status: true, expiresAt: true, plan: { select: { slug: true } } },
    })
    const active = subIsActive(sub) && sub?.plan?.slug === CLUB_PLAN_SLUG
    return { clubId: owned.id, isAdmin: active, isOwner: true }
  }

  const membership = await db.clubMember.findUnique({
    where: { userId },
    select: {
      clubId: true,
      role: true,
      club: {
        select: {
          owner: {
            select: {
              subscription: {
                select: { status: true, expiresAt: true, plan: { select: { slug: true } } },
              },
            },
          },
        },
      },
    },
  })
  if (!membership) return null

  const ownerSub = membership.club.owner.subscription
  const active = subIsActive(ownerSub) && ownerSub?.plan?.slug === CLUB_PLAN_SLUG
  return { clubId: membership.clubId, isAdmin: active && membership.role === 'admin', isOwner: false }
}

/**
 * Every coach whose squads and sessions this user may act on.
 *
 * Always contains the caller. For a club admin it also contains the owner and
 * every seat in that club — including other admins, because a director and a
 * head of coaching covering for each other is the whole point.
 *
 * Returned as an array for `{ userId: { in: ... } }`. The single-element case
 * is the overwhelming majority and costs one extra index lookup, which is the
 * right trade against every call site having to remember two code paths.
 */
export async function coachIdsFor(userId: number): Promise<number[]> {
  const standing = await clubStandingFor(userId)
  if (!standing?.isAdmin) return [userId]

  const [club, members] = await Promise.all([
    db.club.findUnique({ where: { id: standing.clubId }, select: { ownerId: true } }),
    db.clubMember.findMany({ where: { clubId: standing.clubId }, select: { userId: true } }),
  ])

  const ids = new Set<number>([userId])
  if (club) ids.add(club.ownerId)
  for (const m of members) ids.add(m.userId)
  return [...ids]
}

