// ONBOARDING-EMAIL (20 Oct 2026) · reminders for set-password invitations.
//
// 11 of the 12 coaches invited on 10–19 Oct never opened their invitation, and
// nothing reminded them. Now: day 2 a friendly reminder, day 6 the last one —
// each with a FRESH link (a new token voids the old one and runs another 7
// days), in the coach's own language. Coach and club accounts only: a child's
// account is set up through their parent, not chased by email.
//
// Same shape as trial-reminders.ts: an hourly in-process sweep started from
// src/index.ts (never from the app factory, so tests spawn no timers), and
// claim-before-send (updateMany on the count) so overlapping sweeps or a
// restart never send twice.

import { db } from '../config/database.js'
import { env } from '../config/env.js'
import { sendAccountSetupEmail } from '../lib/emails.js'
import { captureError } from '../lib/observability.js'
import { createAccountSetupToken } from '../modules/auth/auth.service.js'

const DAY = 24 * 60 * 60 * 1000
/** When each reminder is due, counted from the invitation. */
export const REMINDER_DAYS = [2, 6] as const
const SWEEP_INTERVAL_MS = 60 * 60 * 1000 // hourly
/** Never send more than this in one sweep (the free email plan allows 300 a day). */
const MAX_PER_SWEEP = 50

export async function sweepSetupReminders(now: Date = new Date()): Promise<number> {
  let sent = 0
  for (const [i, days] of REMINDER_DAYS.entries()) {
    const already = i // reminders sent before this one
    const due = await db.user.findMany({
      where: {
        emailVerifiedAt: null,
        accountType: { in: ['coach', 'club'] },
        setupInvitedAt: { lte: new Date(now.getTime() - days * DAY) },
        setupRemindersSent: already,
      },
      select: { id: true, name: true, email: true, locale: true },
      orderBy: { setupInvitedAt: 'asc' },
      take: MAX_PER_SWEEP - sent,
    })
    for (const u of due) {
      const claimed = await db.user.updateMany({
        where: { id: u.id, setupRemindersSent: already, emailVerifiedAt: null },
        data: { setupRemindersSent: already + 1 },
      })
      if (claimed.count === 0) continue
      const token = await createAccountSetupToken(u.id)
      await sendAccountSetupEmail(u, `${env.FRONTEND_URL}/reset-password?token=${token}`, undefined, { reminder: (already + 1) as 1 | 2 })
      sent += 1
      if (sent >= MAX_PER_SWEEP) return sent
    }
  }
  return sent
}

/** Start the hourly sweep. Returns a stop function. */
export function startSetupReminderScheduler(): () => void {
  const run = () =>
    sweepSetupReminders().catch((err) => {
      console.error('[setup-reminders] sweep failed', err)
      captureError(err, { source: 'job:setup-reminders' })
    })
  const kickoff = setTimeout(run, 20_000)
  const interval = setInterval(run, SWEEP_INTERVAL_MS)
  kickoff.unref()
  interval.unref()
  return () => {
    clearTimeout(kickoff)
    clearInterval(interval)
  }
}
