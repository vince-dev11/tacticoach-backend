// Trial reminder job — emails users whose free trial ends within 2 days.
//
// Runs as an in-process hourly sweep (started from src/index.ts, NOT from the
// app factory, so tests and one-off scripts never spawn timers). Each
// subscription is claimed by setting trialReminderSentAt inside updateMany
// before the email goes out, so a user is reminded at most once even if two
// sweeps overlap or the process restarts mid-run.

import { db } from '../config/database.js'
import { sendTrialReminderEmail } from '../lib/emails.js'

export const TRIAL_REMINDER_WINDOW_MS = 2 * 24 * 60 * 60 * 1000 // 2 days
const SWEEP_INTERVAL_MS = 60 * 60 * 1000 // hourly

/**
 * Find trials expiring within the next 2 days that haven't been reminded yet,
 * claim them, and send the reminder. Returns how many reminders were sent.
 */
export async function sweepTrialReminders(now: Date = new Date()): Promise<number> {
  const windowEnd = new Date(now.getTime() + TRIAL_REMINDER_WINDOW_MS)

  const due = await db.userSubscription.findMany({
    where: {
      status: 'trial',
      trialReminderSentAt: null,
      expiresAt: { gt: now, lte: windowEnd },
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  })

  let sent = 0
  for (const sub of due) {
    // Claim before sending — updateMany with the null-check is atomic, so a
    // concurrent sweep (or a restarted process) can't double-send.
    const claimed = await db.userSubscription.updateMany({
      where: { id: sub.id, trialReminderSentAt: null },
      data: { trialReminderSentAt: now },
    })
    if (claimed.count === 0) continue

    await sendTrialReminderEmail(sub.user, sub.expiresAt!)
    sent += 1
  }
  return sent
}

/** Start the hourly sweep. Returns a stop function. */
export function startTrialReminderScheduler(): () => void {
  const run = () =>
    sweepTrialReminders().catch((err) => console.error('[trial-reminders] sweep failed', err))

  // First sweep shortly after boot (give the DB connection a moment), then hourly.
  const kickoff = setTimeout(run, 10_000)
  const interval = setInterval(run, SWEEP_INTERVAL_MS)
  // Never keep the process alive just for the sweep.
  kickoff.unref()
  interval.unref()

  return () => {
    clearTimeout(kickoff)
    clearInterval(interval)
  }
}
