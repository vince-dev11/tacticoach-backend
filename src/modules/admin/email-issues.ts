// EMAIL-FAIL (14 Oct 2026): "can we actually email this person?" for Admin → Users.
//
// Two reasons an account's email is a problem, both already in our own data:
//   • the address on the account is not an address at all (invalid)
//   • the most recent email we sent them failed (failed), with the provider's
//     reason from email_log
// A later successful send clears the second one, because it is the LATEST
// attempt that matters: one bad day at the provider is not a bad address.
//
// What this cannot see: mail the SMTP server accepted and the recipient's
// server bounced later. Those come back as bounce emails to the sender's
// inbox, not to the API. Catching them needs a provider with bounce webhooks.

import { db } from '../../config/database.js'
import { recipientProblem } from '../../lib/email-address.js'

export interface EmailIssue {
  reason: 'invalid' | 'failed'
  /** Plain words: the address check's reason, or the provider's error. */
  detail: string
  /** When the failed email was sent (failed only). */
  at: string | null
  /** Which email failed — 'account_setup', 'password_reset'… (failed only). */
  kind: string | null
}

interface LatestRow {
  userId: number | null
  status: string
  error: string | null
  kind: string
  createdAt: Date
}

// Narrow view of the email_log delegate: the generated client's types are
// not needed here, and the narrow shape cannot hide a mistake elsewhere.
const emailLog = () =>
  (db as unknown as { emailLog: { findMany(args: unknown): Promise<LatestRow[]> } }).emailLog

/** The email problem, if any, for each of these users (one page of the list). */
export async function emailIssuesFor(users: { id: number; email: string }[]): Promise<Map<number, EmailIssue>> {
  const issues = new Map<number, EmailIssue>()
  if (users.length === 0) return issues

  for (const u of users) {
    const problem = recipientProblem(u.email)
    if (problem) issues.set(u.id, { reason: 'invalid', detail: problem, at: null, kind: null })
  }

  // Latest attempt per user: newest first, first row per user wins.
  const rows =
    (await emailLog().findMany({
      where: { userId: { in: users.map((u) => u.id) } },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, status: true, error: true, kind: true, createdAt: true },
      take: 2000,
    })) ?? []
  const seen = new Set<number>()
  for (const r of rows) {
    if (r.userId == null || seen.has(r.userId)) continue
    seen.add(r.userId)
    if (r.status !== 'failed' || issues.has(r.userId)) continue
    issues.set(r.userId, {
      reason: 'failed',
      detail: r.error?.trim() || 'The email could not be sent',
      at: new Date(r.createdAt).toISOString(),
      kind: r.kind,
    })
  }
  return issues
}

/** Everyone whose most recent email failed — for the "Email problems" filter. */
export async function usersWhoseLastEmailFailed(): Promise<number[]> {
  const rows =
    (await db.$queryRaw<{ user_id: number }[]>`
      SELECT e.user_id
      FROM email_log e
      JOIN (SELECT user_id, MAX(id) AS last_id FROM email_log WHERE user_id IS NOT NULL GROUP BY user_id) l
        ON l.last_id = e.id
      WHERE e.status = 'failed'
    `) ?? []
  return rows.map((r) => Number(r.user_id))
}
