// BULK-MAIL (owner, 4 Nov 2026): Admin → Users → "Email everyone".
//
// One message from the team to coaches and clubs, sent as individual emails
// (each says "Hi <first name>"), recorded in the email log like every other
// mail, with a one-click opt-out on every copy. Players (often children) and
// parents are never in a bulk send; an account without a login of its own,
// without an address, or that opted out is skipped.
//
// Audiences — the owner's three filters:
//   all        every coach and club account
//   signed_in  those who have signed in at least once (first_login_at set)
//   set_up     invited accounts that set their password from the link
//              (setup_completed_at set)
//
// The opt-out link carries the user id and an HMAC of it under the refresh
// secret, so nobody can opt someone else out by guessing; opting out needs no
// sign-in (people click it from the mail client on a phone).
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { db } from '../config/database.js'
import { env } from '../config/env.js'
import { sendAdminMessage } from './emails.js'

export const AUDIENCES = ['all', 'signed_in', 'set_up'] as const
export type Audience = (typeof AUDIENCES)[number]

/** Never more than this in one send — the request is awaited; a bigger list is sent in two goes. */
export const BULK_MAX = 500
/** A short breath between copies so the provider's per-second limit is never hit. */
export const BULK_GAP_MS = 120

/** Who a bulk send can reach, before the audience filter. */
const REACHABLE: Prisma.UserWhereInput = {
  accountType: { in: ['coach', 'club'] },
  canLogin: true,
  email: { contains: '@' },
  teamUpdatesOptOutAt: null,
}

export function audienceWhere(audience: Audience): Prisma.UserWhereInput {
  const extra: Prisma.UserWhereInput =
    audience === 'signed_in' ? { firstLoginAt: { not: null } }
    : audience === 'set_up' ? { setupCompletedAt: { not: null } }
    : {}
  return { AND: [REACHABLE, extra] }
}

/** How many would get it, and how many coaches/clubs have opted out (for the admin's eyes). */
export async function audienceCount(audience: Audience): Promise<{ count: number; optedOut: number }> {
  const [count, optedOut] = await Promise.all([
    db.user.count({ where: audienceWhere(audience) }),
    db.user.count({ where: { accountType: { in: ['coach', 'club'] }, teamUpdatesOptOutAt: { not: null } } }),
  ])
  return { count, optedOut }
}

// ---- Opt-out link --------------------------------------------------------------

function sign(userId: number): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(`team-updates:${userId}`).digest('hex').slice(0, 32)
}

export function optOutUrl(userId: number): string {
  return `${(env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, '')}/api/account/team-updates/opt-out?u=${userId}&t=${sign(userId)}`
}

/** True when the token belongs to this user id (constant-time). */
export function optOutTokenOk(userId: number, token: string): boolean {
  const want = sign(userId)
  return token.length === want.length && timingSafeEqual(Buffer.from(token), Buffer.from(want))
}

/** Record the opt-out. Idempotent; a second click changes nothing. */
export async function optOut(userId: number): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, teamUpdatesOptOutAt: true } })
  if (!user) return false
  if (!user.teamUpdatesOptOutAt) await db.user.update({ where: { id: userId }, data: { teamUpdatesOptOutAt: new Date() } })
  return true
}

// ---- Sending ----------------------------------------------------------------

export interface BulkResult {
  audience: Audience
  recipients: number
  sent: number
  failed: number
  skipped: number
  /** True when more than BULK_MAX matched: send again for the rest. */
  truncated: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** `{name}` → first name, as the single-user composer does on the web. */
export function personalise(text: string, firstName: string): string {
  return text.replace(/\{name\}/g, firstName.trim() || 'coach')
}

export async function sendTeamUpdate(params: {
  audience: Audience
  subject: string
  body: string
  actorId?: number
}): Promise<BulkResult> {
  const users = await db.user.findMany({
    where: audienceWhere(params.audience),
    select: { id: true, name: true, email: true },
    orderBy: { id: 'asc' },
    take: BULK_MAX + 1,
  })
  const truncated = users.length > BULK_MAX
  const list = users.slice(0, BULK_MAX)
  const result: BulkResult = { audience: params.audience, recipients: list.length, sent: 0, failed: 0, skipped: 0, truncated }
  for (const [i, u] of list.entries()) {
    const status = await sendAdminMessage({
      to: u.email,
      name: u.name,
      subject: personalise(params.subject, u.name),
      body: personalise(params.body, u.name),
      kind: 'team_update',
      userId: u.id,
      actorId: params.actorId,
      optOutUrl: optOutUrl(u.id),
    })
    if (status === 'sent') result.sent++
    else if (status === 'failed') result.failed++
    else result.skipped++
    if (i < list.length - 1) await sleep(BULK_GAP_MS)
  }
  return result
}
