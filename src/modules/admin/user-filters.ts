// Admin → Users filters (6 Oct 2026). One place that says what "on trial",
// "trial ending" and "paying" mean, so the list, its counts and the overview
// card can never disagree.
//
// There are two kinds of trial, and the admin cares about both:
//   • the free 14-day trial, which lives on the user (`freeTrialEndsAt`,
//     lib/free-trial.ts) and applies only while nothing paid covers them;
//   • an older `trial` subscription row (status 'trial', `expiresAt`).
import type { Prisma } from '@prisma/client'
import { z } from 'zod'

const DAY = 86_400_000
/** "Ending soon" = within this many days. */
export const TRIAL_ENDING_DAYS = 7

export const UserFilters = z.object({
  search: z.string().trim().max(200).catch(''),
  type: z.enum(['coach', 'club', 'player']).optional().catch(undefined),
  /**
   * trial        – a trial is running
   * trial_ending – a trial ends within 7 days
   * trial_ended  – the trial is over and nothing paid replaced it
   * paid         – an active Stripe subscription
   * gift         – an active complimentary plan
   * lapsed       – a subscription that was cancelled or expired
   */
  plan: z.enum(['trial', 'trial_ending', 'trial_ended', 'paid', 'gift', 'lapsed']).optional().catch(undefined),
  verified: z.enum(['yes', 'no']).optional().catch(undefined),
  /** Joined within this many days. */
  joined: z.coerce.number().int().refine((n) => [7, 30, 90].includes(n)).optional().catch(undefined),
  content: z.enum(['some', 'none']).optional().catch(undefined),
  sort: z.enum(['newest', 'oldest', 'trial_end']).catch('newest'),
  page: z.coerce.number().int().min(1).catch(1),
})
export type UserFilterInput = z.infer<typeof UserFilters>

/** Something paid (or a sub-trial) is live right now. */
function liveSub(now: Date): Prisma.UserWhereInput {
  return {
    subscription: {
      is: { status: { in: ['active', 'trial'] }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    },
  }
}

/** The free trial counts only for someone nothing else covers. */
function onFreePlan(now: Date): Prisma.UserWhereInput {
  return {
    accountType: { not: 'player' },
    clubMembership: { is: null },
    NOT: liveSub(now),
  }
}

/** A trial ending inside (from, to]. `to` undefined = no upper bound. */
export function trialEndsWithin(from: Date, to?: Date): Prisma.UserWhereInput {
  const range = { gt: from, ...(to ? { lte: to } : {}) }
  return {
    OR: [
      { subscription: { is: { status: 'trial', expiresAt: range } } },
      { AND: [onFreePlan(from), { freeTrialEndsAt: range }] },
    ],
  }
}

export function trialEndingSoon(now: Date): Prisma.UserWhereInput {
  return trialEndsWithin(now, new Date(now.getTime() + TRIAL_ENDING_DAYS * DAY))
}

function planWhere(plan: NonNullable<UserFilterInput['plan']>, now: Date): Prisma.UserWhereInput {
  switch (plan) {
    case 'trial':
      return trialEndsWithin(now)
    case 'trial_ending':
      return trialEndingSoon(now)
    case 'trial_ended':
      return {
        OR: [
          { subscription: { is: { status: 'trial', expiresAt: { lte: now } } } },
          { AND: [onFreePlan(now), { freeTrialEndsAt: { lte: now } }, { NOT: { subscription: { is: { status: { in: ['cancelled', 'expired'] } } } } }] },
        ],
      }
    case 'paid':
      return { AND: [liveSub(now), { subscription: { is: { status: 'active', paymentProvider: 'stripe' } } }] }
    case 'gift':
      return { AND: [liveSub(now), { subscription: { is: { status: 'active', paymentProvider: 'complimentary' } } }] }
    case 'lapsed':
      return { subscription: { is: { status: { in: ['cancelled', 'expired'] } } } }
  }
}

export function userWhere(f: UserFilterInput, now: Date = new Date()): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = []
  if (f.search) {
    and.push({
      OR: [
        { email: { contains: f.search } },
        { name: { contains: f.search } },
        { surname: { contains: f.search } },
        { clubName: { contains: f.search } },
      ],
    })
  }
  if (f.type) and.push({ accountType: f.type })
  if (f.plan) and.push(planWhere(f.plan, now))
  if (f.verified) and.push({ emailVerifiedAt: f.verified === 'yes' ? { not: null } : null })
  if (f.joined) and.push({ createdAt: { gte: new Date(now.getTime() - f.joined * DAY) } })
  if (f.content === 'some') and.push({ OR: [{ boards: { some: {} } }, { drillSheets: { some: {} } }] })
  if (f.content === 'none') and.push({ boards: { none: {} }, drillSheets: { none: {} } })
  return and.length ? { AND: and } : {}
}

/**
 * When this person's trial ends, or null when they are not on one. Mirrors
 * the where-clauses above for one row, so the badge and the filter agree.
 */
export function trialEndsAt(
  u: {
    accountType: string
    freeTrialEndsAt: Date | null
    clubMembership?: { id: number } | null
    subscription: { status: string; expiresAt: Date | null } | null
  },
  now: Date = new Date(),
): Date | null {
  const sub = u.subscription
  if (sub?.status === 'trial') return sub.expiresAt
  const live = !!sub && sub.status === 'active' && (!sub.expiresAt || sub.expiresAt > now)
  if (live || u.accountType === 'player' || u.clubMembership) return null
  return u.freeTrialEndsAt
}
