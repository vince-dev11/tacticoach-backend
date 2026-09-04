import { db } from '../../config/database.js'
import { uploadToS3, deleteFromS3, presignUrl } from '../../config/s3.js'
import type { UpdateProfileInput, TourId, SaveSquadInput } from './users.schema.js'

const USER_SELECT = {
  id: true,
  role: true,
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
    await db.user.update({ where: { id: userId }, data: { toursDone: [...done, tour] } })
    return [...done, tour]
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

const SQUAD_SELECT = { id: true, name: true, number: true, position: true, sortOrder: true } as const

export async function getSquad(userId: number) {
  return db.squadPlayer.findMany({
    where: { userId },
    orderBy: { sortOrder: 'asc' },
    select: SQUAD_SELECT,
  })
}

/**
 * Replace-all save: the profile edits the squad as one list, so persisting it
 * as delete + createMany (in a transaction) is simpler and safer than diffing.
 */
export async function saveSquad(userId: number, players: SaveSquadInput['players']) {
  await db.$transaction([
    db.squadPlayer.deleteMany({ where: { userId } }),
    db.squadPlayer.createMany({
      data: players.map((p, i) => ({
        userId,
        name: p.name,
        number: p.number,
        position: p.position ?? null,
        sortOrder: i,
      })),
    }),
  ])
  return getSquad(userId)
}
