import { db } from '../../config/database.js'
import { uploadToS3, deleteFromS3, presignUrl } from '../../config/s3.js'
import type { UpdateProfileInput } from './users.schema.js'

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
  emailVerifiedAt: true,
  createdAt: true,
  subscription: {
    include: { plan: true },
  },
} as const

export async function getUserProfile(userId: number) {
  const user = await db.user.findUnique({ where: { id: userId }, select: USER_SELECT })
  if (!user) return null
  // Replace raw S3 key with a short-lived presigned URL for the logo
  if (user.clubLogoKey) {
    return { ...user, clubLogoUrl: await presignUrl(user.clubLogoKey) }
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
    },
    select: USER_SELECT,
  })
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
