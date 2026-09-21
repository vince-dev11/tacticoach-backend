// How many videos this coach may still export this month.
//
// Basic includes animation and video export — that is the point, it is why
// coaches try the product — but capped, because encoding and storing video is
// the only feature here with a real marginal cost. Pro is unlimited.

import { db } from '../config/database.js'
import { can, limitsFor } from './capabilities.js'
import { getEntitlements } from './entitlements.js'

// ---- TEMPORARY: remove once `prisma generate` has run against migration 30 --
const exportsDb = () =>
  (db as unknown as {
    videoExport: {
      count(a?: unknown): Promise<number>
      create(a: unknown): Promise<unknown>
    }
  }).videoExport

/** First moment of the current calendar month, in UTC. */
function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export interface VideoQuota {
  /** null = unlimited. */
  limit: number | null
  used: number
  remaining: number | null
  allowed: boolean
  /** Whether this plan exports HD without our watermark. */
  hd: boolean
}

/**
 * The quota as it stands right now.
 *
 * A calendar month rather than a rolling 30 days, because "you get 10 a month"
 * is a sentence a coach can check against a calendar, and a rolling window is
 * one they cannot — the tenth export silently becoming available again on a
 * different day each time is the kind of thing that generates support email.
 */
export async function videoQuota(userId: number): Promise<VideoQuota> {
  const ent = await getEntitlements(userId)
  const limits = limitsFor(ent)
  const hd = can(ent, 'video_hd')

  if (limits.videoExports === null) {
    return { limit: null, used: 0, remaining: null, allowed: true, hd }
  }

  const used = await exportsDb().count({
    where: { userId, createdAt: { gte: monthStart() } },
  })
  return {
    limit: limits.videoExports,
    used,
    remaining: Math.max(0, limits.videoExports - used),
    allowed: used < limits.videoExports,
    hd,
  }
}

/** Record an export. Called only after the upload has actually succeeded. */
export async function recordVideoExport(
  userId: number, boardId: number | null, planSlug: string | null,
): Promise<void> {
  // Best-effort: a coach who exported a video must never see it fail because
  // the meter could not be written. Under-counting is a cheaper mistake than
  // losing the export they were waiting on.
  await exportsDb()
    .create({ data: { userId, boardId, planSlug } })
    .catch(() => undefined)
}
