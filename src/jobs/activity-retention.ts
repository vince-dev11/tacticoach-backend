// ACTIVITY-LOG retention (23 Nov 2026): the coach activity log is kept 13
// months, then deleted — what the Privacy Policy says. Swept daily.

import { db } from '../config/database.js'
import { captureError } from '../lib/observability.js'

export const ACTIVITY_KEEP_DAYS = 396 // 13 months
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

export async function sweepActivity(now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - ACTIVITY_KEEP_DAYS * 86_400_000)
  const { count } = await db.activityEvent.deleteMany({ where: { createdAt: { lt: before } } })
  return count
}

export function startActivityRetention(): () => void {
  const run = () =>
    sweepActivity().catch((err) => {
      console.error('[activity-retention] sweep failed', err)
      captureError(err, { source: 'job:activity-retention' })
    })
  const kickoff = setTimeout(run, 60_000)
  const interval = setInterval(run, SWEEP_INTERVAL_MS)
  kickoff.unref()
  interval.unref()
  return () => {
    clearTimeout(kickoff)
    clearInterval(interval)
  }
}
