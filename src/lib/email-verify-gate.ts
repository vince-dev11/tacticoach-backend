// VERIFY-GATE (16 Oct 2026, owner): nobody uses TactiCoach until they have
// verified their email address.
//
// Decisions:
//   • Everyone who logs in is gated — coaches, clubs, parents, 13–17 players.
//     (People who joined through an emailed link — a set-up link, a parent
//     invite — are verified by following it, so they never see the gate.)
//   • Accounts that existed before the gate get 7 days' grace from the day it
//     started, with a countdown banner; accounts made after it are gated at once.
//   • While gated they can look around (every GET works); anything that does
//     something — save a board, write a sheet, send feedback, buy a book — is
//     refused with 403 `email_unverified`, and the app shows the verify screen.
//     Their own account stays theirs: verifying, resending, changing the email
//     or password, deleting the account and logging out always work.
//   • The owner (admin) is never gated.
//
// The UI gate is a courtesy; this file is the enforcement (authGuard).

import { db } from '../config/database.js'
import { env } from '../config/env.js'

const DAY = 86_400_000
export const VERIFY_GRACE_DAYS = 7

/** The day the gate started (override with EMAIL_VERIFY_GATE_FROM=YYYY-MM-DD). */
export function gateFrom(): Date {
  const raw = env.EMAIL_VERIFY_GATE_FROM?.trim()
  const d = raw ? new Date(`${raw}T00:00:00Z`) : new Date('2026-10-16T00:00:00Z')
  return Number.isNaN(d.getTime()) ? new Date('2026-10-16T00:00:00Z') : d
}

export interface GateUser {
  email?: string | null
  emailVerifiedAt: Date | null
  createdAt: Date
  role?: string | null
}

/** When this account's grace ends: 7 days after the gate started for older accounts; at once for newer ones. */
export function graceEndsAt(u: GateUser, from: Date = gateFrom()): Date {
  return u.createdAt < from ? new Date(from.getTime() + VERIFY_GRACE_DAYS * DAY) : u.createdAt
}

/** The account's state, as /users/me reports it to the app. */
export function verificationState(u: GateUser, now: Date = new Date()): { verified: boolean; required: boolean; graceEndsAt: string | null } {
  if (u.emailVerifiedAt || u.role === 'owner' || !gateSwitch.on || isTestAddress(u.email)) return { verified: !!u.emailVerifiedAt, required: false, graceEndsAt: null }
  const ends = graceEndsAt(u)
  return { verified: false, required: now >= ends, graceEndsAt: ends > now ? ends.toISOString() : null }
}

/**
 * Off production only: an address on the reserved `.test` domain (RFC 2606)
 * can never receive the link, so it is never gated — this is what the live
 * Playwright suite registers (e2e.<type>.<run>@tacticoach.test) on every run.
 * In production anyone could type such an address, so there it counts for
 * nothing.
 */
export function isTestAddress(email: string | null | undefined): boolean {
  return env.NODE_ENV !== 'production' && !!email && /@[^@\s]+\.test$/i.test(email.trim())
}

/** Writes an unverified account may still make: its own account and getting verified. */
const ALWAYS_ALLOWED: RegExp[] = [
  /^\/api\/auth\//, // verify, resend, refresh, logout
  /^\/api\/users\/me(\?.*)?$/, // PATCH (correct the email) and DELETE (close the account)
  /^\/api\/users\/me\/password(\/check)?(\?.*)?$/,
  /^\/api\/users\/me\/tours(\?.*)?$/, // "tour seen" — harmless
  /^\/api\/family\/invite\//, // a parent answering an invite verifies by doing so
]

export function allowedWhileUnverified(method: string, url: string): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true
  return ALWAYS_ALLOWED.some((r) => r.test(url))
}

// A small cache so a write costs no extra query once we know the answer.
// Verified is permanent until the email changes (which clears it); 30 s is
// how long a just-verified coach might wait at most — and verify-email clears
// the entry immediately anyway.
const TTL_MS = 30_000
const cache = new Map<number, { user: GateUser; at: number }>()
export function forgetGate(userId: number): void {
  cache.delete(userId)
}

async function gateUser(userId: number): Promise<GateUser | null> {
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.user
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, createdAt: true, role: true } })
  if (!user) return null
  if (cache.size > 5000) cache.clear()
  cache.set(userId, { user, at: Date.now() })
  return user
}

/**
 * On everywhere except the unit tests, whose mocked users are mostly
 * unverified and are about something else; tests/verify-gate.test.ts turns it on.
 * Off on a developer's machine with EMAIL_VERIFY_GATE=off (never in production).
 */
export const gateSwitch = {
  on: env.NODE_ENV === 'production' || (env.NODE_ENV !== 'test' && env.EMAIL_VERIFY_GATE),
}

/** True when this request must be refused because the account still has to verify its email. */
export async function blockedUntilVerified(userId: number, method: string, url: string): Promise<boolean> {
  if (!gateSwitch.on || allowedWhileUnverified(method, url)) return false
  const user = await gateUser(userId)
  if (!user) return false // the route answers 404 itself
  return verificationState(user).required
}
