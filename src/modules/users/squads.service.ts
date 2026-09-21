// A coach's teams.
//
// Most coaches have exactly one and should never be asked to think about this.
// So every read has a default: ask for "the coach's squads" and you get at
// least one, creating it on demand if the coach has never had players.
//
// The rule that shapes everything here: ONE COACH, ONE PLAYER, ONE ROW.
// `squad_players` is unique on (user_id, player_user_id), because a second row
// for the same child would split their note history — a player moving up from
// the U13s to the U15s mid-season would lose their record at the moment it
// finally means something. Moving squads MOVES the row; the notes follow.

import { db } from '../../config/database.js'
import { limitsFor } from '../../lib/capabilities.js'
import { getEntitlements } from '../../lib/entitlements.js'

/** The name a coach's first squad gets when we make it for them. */
export const DEFAULT_SQUAD_NAME = 'My squad'

// ---- TEMPORARY: remove once `prisma generate` has run against migration 22 --
//
// The generated client has no `squad` delegate until then, so every call below
// is a type error against a model that certainly exists in the schema. Eleven
// of them drown out anything real, which would leave the rest of this build
// unchecked — so the delegate is named here instead.
//
// The return types are the honest ones, so callers stay checked. The ARGUMENT
// types are not, which is the cost: a typo in a `where` clause compiles. Delete
// this block and the `squads()` calls after generating, and tsc gets it back.
export interface SquadRow {
  id: number
  userId: number
  name: string
  ageGroup: string | null
  sortOrder: number
  archivedAt: Date | null
}

interface SquadDelegate {
  findMany(args?: unknown): Promise<SquadRow[]>
  findFirst(args?: unknown): Promise<SquadRow | null>
  create(args: unknown): Promise<SquadRow>
  update(args: unknown): Promise<SquadRow>
  updateMany(args: unknown): Promise<{ count: number }>
  count(args?: unknown): Promise<number>
}

const squads = () => (db as unknown as { squad: SquadDelegate }).squad

export const SQUAD_SELECT = {
  id: true,
  name: true,
  ageGroup: true,
  sortOrder: true,
} as const

/** Every live squad this coach has, in their own order. */
export async function listSquads(userId: number) {
  return squads().findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: SQUAD_SELECT,
  })
}

/**
 * The squad to use when nothing says otherwise — a session with no squad, the
 * editor's player shelf, the profile opening for the first time.
 *
 * Creates one if the coach has none, so no caller has to handle "no squad
 * yet". That is the state every account starts in, and making each call site
 * remember it is how half of them forget.
 */
export async function defaultSquad(userId: number) {
  const existing = await squads().findFirst({
    where: { userId, archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: SQUAD_SELECT,
  })
  if (existing) return existing

  const coach = await db.user.findUnique({
    where: { id: userId },
    select: { coachAgeGroup: true },
  })
  const ageGroup = coach?.coachAgeGroup?.trim() || null

  return squads().create({
    // Named from the coach's own age group when they set one, so their first
    // squad reads "U13" rather than something generic they have to rename.
    data: { userId, name: ageGroup || DEFAULT_SQUAD_NAME, ageGroup, sortOrder: 0 },
    select: SQUAD_SELECT,
  })
}

/**
 * Resolve a squad id the client asked for, refusing anything this coach does
 * not own. Falls back to the default rather than erroring, because a stale id
 * (a squad archived in another tab) should show the coach their players, not
 * an error page.
 */
export async function resolveSquad(userId: number, squadId?: number | null) {
  if (squadId) {
    const owned = await squads().findFirst({
      where: { id: squadId, userId, archivedAt: null },
      select: SQUAD_SELECT,
    })
    if (owned) return owned
  }
  return defaultSquad(userId)
}

/**
 * Thrown when a plan's limit stops an action. 402 rather than 403: this is
 * "not on your plan yet", which is a thing the coach can do something about —
 * and the frontend turns it into an upgrade prompt at exactly the moment the
 * feature was wanted, which is the only moment it is persuasive.
 */
export function planLimitError(message: string): Error & { statusCode: number } {
  const e = new Error(message) as Error & { statusCode: number }
  e.statusCode = 402
  return e
}

export async function createSquad(userId: number, name: string, ageGroup: string | null) {
  const count = await squads().count({ where: { userId, archivedAt: null } })

  // Squads are the honest line between the tiers: one team is a volunteer,
  // three teams is a professional. Counted here rather than in the route so it
  // cannot be bypassed by any other caller.
  const limit = limitsFor(await getEntitlements(userId)).squads
  if (limit !== null && count >= limit) {
    throw planLimitError(
      limit === 1
        ? 'Your plan covers one squad. Upgrade to Pro for unlimited squads.'
        : `Your plan covers ${limit} squads.`,
    )
  }

  return squads().create({
    data: { userId, name: name.trim(), ageGroup: ageGroup?.trim() || null, sortOrder: count },
    select: SQUAD_SELECT,
  })
}

export async function renameSquad(
  userId: number,
  squadId: number,
  patch: { name?: string; ageGroup?: string | null },
) {
  const { count } = await squads().updateMany({
    where: { id: squadId, userId, archivedAt: null },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.ageGroup !== undefined ? { ageGroup: patch.ageGroup?.trim() || null } : {}),
    },
  })
  return count > 0
}

/**
 * Retire a squad.
 *
 * Archived, never deleted: its players own note histories, and its sessions
 * are a record of work the coach actually did. The players go with it — they
 * are that team's players — and a coach who wants to keep one moves them
 * first.
 *
 * The last live squad cannot be archived. A coach with no squad at all would
 * get one silently recreated by `defaultSquad` on the next read, which looks
 * like the app undoing what they just did.
 */
export async function archiveSquad(
  userId: number,
  squadId: number,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'last_one' }> {
  const live = await squads().findMany({
    where: { userId, archivedAt: null },
    select: { id: true },
  })
  if (!live.some((s) => s.id === squadId)) return { ok: false, reason: 'not_found' }
  if (live.length <= 1) return { ok: false, reason: 'last_one' }

  await squads().update({ where: { id: squadId }, data: { archivedAt: new Date() } })
  return { ok: true }
}

/**
 * Move a player to another of this coach's squads.
 *
 * One UPDATE, deliberately — not a delete and a create. The row carries the
 * player's account link and every note ever written to them; recreating it
 * would hand a child a blank season on the day they got promoted.
 */
export async function movePlayer(
  userId: number,
  squadPlayerId: number,
  toSquadId: number,
): Promise<boolean> {
  const [player, squad] = await Promise.all([
    db.squadPlayer.findFirst({
      where: { id: squadPlayerId, userId, archivedAt: null },
      select: { id: true },
    }),
    squads().findFirst({ where: { id: toSquadId, userId, archivedAt: null }, select: { id: true } }),
  ])
  if (!player || !squad) return false

  // Sorted to the end of the destination: a moved player is new to that team
  // and nobody has chosen where they belong in the order yet.
  const count = await db.squadPlayer.count({ where: { squadId: toSquadId, archivedAt: null } })
  await db.squadPlayer.update({
    where: { id: player.id },
    data: { squadId: toSquadId, sortOrder: count },
  })
  return true
}
