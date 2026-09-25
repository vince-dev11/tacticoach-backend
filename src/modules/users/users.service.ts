import { db } from '../../config/database.js'
import { resolveSquad } from './squads.service.js'
import { uploadToS3, deleteFromS3, presignUrl } from '../../config/s3.js'
import type { UpdateProfileInput, TourId, SaveSquadInput } from './users.schema.js'

const USER_SELECT = {
  id: true,
  role: true,
  accountType: true,
  name: true,
  surname: true,
  email: true,
  phone: true,
  clubName: true,
  clubLogoUrl: true,
  clubLogoKey: true,
  instagramUrl: true,
  youtubeUrl: true,
  twitterUrl: true,
  facebookUrl: true,
  coachAgeGroup: true,
  coachFormat: true,
  coachLevel: true,
  coachFormation: true,
  coachSquadSize: true,
  toursDone: true,
  emailVerifiedAt: true,
  createdAt: true,
  subscription: {
    include: { plan: true },
  },
} as const

export async function getUserProfile(userId: number) {
  const user = await db.user.findUnique({ where: { id: userId }, select: USER_SELECT })
  if (!user) return null
  // Replace raw S3 key with a short-lived presigned URL for the logo.
  // Presign failure (S3 down / unconfigured) must not break the whole profile
  // read — pre-launch QA found every profile save 503ing on a dev box because
  // of this line. The logo just goes missing until storage is back.
  if (user.clubLogoKey) {
    try {
      return { ...user, clubLogoUrl: await presignUrl(user.clubLogoKey) }
    } catch {
      return { ...user, clubLogoUrl: null }
    }
  }
  return user
}

export async function updateUserProfile(userId: number, input: UpdateProfileInput) {
  return db.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.surname !== undefined && { surname: input.surname }),
      ...(input.accountType !== undefined && { accountType: input.accountType }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.clubName !== undefined && { clubName: input.clubName }),
      ...(input.instagramUrl !== undefined && { instagramUrl: input.instagramUrl }),
      ...(input.youtubeUrl !== undefined && { youtubeUrl: input.youtubeUrl }),
      ...(input.twitterUrl !== undefined && { twitterUrl: input.twitterUrl }),
      ...(input.facebookUrl !== undefined && { facebookUrl: input.facebookUrl }),
      ...(input.coachAgeGroup !== undefined && { coachAgeGroup: input.coachAgeGroup }),
      ...(input.coachFormat !== undefined && { coachFormat: input.coachFormat }),
      ...(input.coachLevel !== undefined && { coachLevel: input.coachLevel }),
      ...(input.coachFormation !== undefined && { coachFormation: input.coachFormation }),
      ...(input.coachSquadSize !== undefined && { coachSquadSize: input.coachSquadSize }),
    },
    select: USER_SELECT,
  })
}

/**
 * Record a completed guided tour on the account. Idempotent — completing a
 * tour twice (two tabs, a retry) never duplicates the entry.
 */
export async function markTourDone(userId: number, tour: TourId) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { toursDone: true } })
  const done = Array.isArray(user.toursDone) ? (user.toursDone as string[]) : []
  if (!done.includes(tour)) {
    // Release markers accumulate one per release; keep the list bounded so an
    // account that has seen every release for years still carries a short
    // array. Tours are never dropped — only the oldest release markers.
    const next = [...done, tour]
    const releases = next.filter((x) => x.startsWith('release:'))
    const trimmed = releases.length > 24
      ? next.filter((x) => !x.startsWith('release:') || releases.slice(-24).includes(x))
      : next
    await db.user.update({ where: { id: userId }, data: { toursDone: trimmed } })
    return trimmed
  }
  return done
}

export async function uploadClubLogo(userId: number, buffer: Buffer, mimeType: string, ext: string) {
  // Delete old logo from S3 if present
  const existing = await db.user.findUnique({ where: { id: userId }, select: { clubLogoKey: true } })
  if (existing?.clubLogoKey) {
    await deleteFromS3(existing.clubLogoKey).catch(() => { /* best-effort */ })
  }

  const key = `logos/${userId}/${Date.now()}.${ext}`
  await uploadToS3(key, buffer, mimeType)

  await db.user.update({
    where: { id: userId },
    data: { clubLogoKey: key, clubLogoUrl: null }, // URL is always presigned on read
  })

  return presignUrl(key)
}

export async function deleteClubLogo(userId: number) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { clubLogoKey: true } })
  if (!user?.clubLogoKey) return
  await deleteFromS3(user.clubLogoKey).catch(() => { /* best-effort */ })
  await db.user.update({ where: { id: userId }, data: { clubLogoKey: null, clubLogoUrl: null } })
}

// ---- My Squad ---------------------------------------------------------------

const SQUAD_SELECT = {
  id: true,
  name: true,
  number: true,
  position: true,
  sortOrder: true,
  // The player's own account, once linked. The profile's squad editor shows
  // this so a coach can see who is connected and who still needs asking.
  playerUserId: true,
  linkStatus: true,
  guardianEmail: true,
} as const

/**
 * One squad's players.
 *
 * `squadId` is resolved, not trusted: an id belonging to another coach, or one
 * archived in another tab, falls back to this coach's default squad rather
 * than erroring or — far worse — reading someone else's roster.
 */
export async function getSquad(userId: number, squadId?: number | null) {
  const squad = await resolveSquad(userId, squadId)
  const players = await db.squadPlayer.findMany({
    // Archived rows are kept only so the notes written to that player survive;
    // they are not part of the squad any more and never come back in reads.
    where: { userId, squadId: squad.id, archivedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: SQUAD_SELECT,
  })
  return { squad, players }
}

/**
 * Save the squad the profile edited.
 *
 * This USED to be delete-everything + createMany, which was perfectly safe
 * while a row held nothing but a name, a number and a position. It is not safe
 * now: a row owns the link to a player's account and every note that coach has
 * ever written them, so recreating the list would silently destroy a player's
 * whole record every time their coach fixed a shirt number.
 *
 * So rows are matched by id and updated in place. A row the coach dropped is
 * archived when it has anything worth keeping, and only deleted outright when
 * it is genuinely empty.
 */
export async function saveSquad(
  userId: number,
  players: SaveSquadInput['players'],
  squadId?: number | null,
) {
  const squad = await resolveSquad(userId, squadId)
  // Scoped to ONE squad. Without the squadId here, saving the U13s would
  // archive every U15 as "dropped" — the replace-all shape is only safe
  // against the list the coach was actually editing.
  const existing = await db.squadPlayer.findMany({
    where: { userId, squadId: squad.id, archivedAt: null },
    select: { id: true, playerUserId: true, _count: { select: { notes: true } } },
  })
  const existingById = new Map(existing.map((row) => [row.id, row]))

  const keptIds = new Set<number>()
  const ops = []

  players.forEach((p, i) => {
    const data = { name: p.name, number: p.number, position: p.position ?? null, sortOrder: i }
    // An id the coach does not own is treated as a new player rather than
    // trusted — the id comes from the client.
    if (p.id && existingById.has(p.id)) {
      keptIds.add(p.id)
      ops.push(db.squadPlayer.update({ where: { id: p.id }, data }))
    } else {
      ops.push(db.squadPlayer.create({ data: { userId, squadId: squad.id, ...data } }))
    }
  })

  for (const row of existing) {
    if (keptIds.has(row.id)) continue
    // Defensive on `_count`: if this row ever arrives from a narrower select,
    // the safe reading is "might have notes", so archive rather than delete.
    const noteCount = row._count?.notes
    const worthKeeping = noteCount === undefined || noteCount > 0 || row.playerUserId !== null
    ops.push(
      worthKeeping
        ? db.squadPlayer.update({
            where: { id: row.id },
            data: { archivedAt: new Date(), linkStatus: null },
          })
        : db.squadPlayer.delete({ where: { id: row.id } }),
    )
  }

  await db.$transaction(ops)
  return getSquad(userId, squad.id)
}
