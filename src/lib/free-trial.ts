import { Prisma } from '@prisma/client'
import { db } from '../config/database.js'

// The free plan is a 14-day trial (decided 1 Oct 2026). The window is a
// column on the user, not a subscription row, because the free tier never had
// one. Ended means ended at the instant itself, and a missing end date means
// ended too: an account with no window must never read as unlimited.

/** Length of the free trial. Confirmed 14 days on 1 Oct 2026. */
export const TRIAL_DAYS = 14

export function freeTrialEnd(now: Date = new Date()): Date {
  return new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
}

export function freeTrialActive(endsAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !!endsAt && endsAt.getTime() > now.getTime()
}

// ---- Lifetime counts ------------------------------------------------------
//
// On the free trial a slot is spent when something is CREATED and never given
// back on delete. One row per coach in `free_usage`; a slot is taken with a
// single conditional UPDATE, so two creates racing for the last slot cannot
// both win.

export type FreeQuotaKey = 'boards' | 'drillSheets' | 'sessions' | 'seasons' | 'books'

const COLUMN: Record<FreeQuotaKey, string> = {
  boards: 'boards',
  drillSheets: 'drill_sheets',
  sessions: 'sessions',
  seasons: 'seasons',
  books: 'books',
}

/** Take `count` slots if they are all there. True when they were taken. */
export async function reserveFreeSlot(userId: number, key: FreeQuotaKey, limit: number, count = 1): Promise<boolean> {
  await db.freeUsage.upsert({ where: { userId }, create: { userId }, update: {} })
  const col = Prisma.raw('`' + COLUMN[key] + '`')
  const n = await db.$executeRaw`UPDATE \`free_usage\` SET ${col} = ${col} + ${count} WHERE \`user_id\` = ${userId} AND ${col} + ${count} <= ${limit}`
  return n === 1
}

/** Give slots back — only when the create they were reserved for failed. */
export async function releaseFreeSlot(userId: number, key: FreeQuotaKey, count = 1): Promise<void> {
  const col = Prisma.raw('`' + COLUMN[key] + '`')
  await db.$executeRaw`UPDATE \`free_usage\` SET ${col} = GREATEST(${col} - ${count}, 0) WHERE \`user_id\` = ${userId}`
}

/** Slots spent so far. */
export async function freeUsed(userId: number, key: FreeQuotaKey): Promise<number> {
  const row = await db.freeUsage.findUnique({ where: { userId } })
  return (row as Record<string, number> | null)?.[key] ?? 0
}
