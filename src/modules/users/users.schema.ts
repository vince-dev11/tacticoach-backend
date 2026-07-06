import { z } from 'zod'

// Social links: https URLs shown on exported drill sheets. An empty string
// clears the field (stored as null).
const SocialUrl = z
  .union([z.string().url().max(300), z.literal('').transform(() => null)])
  .optional()
  .nullable()

export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  surname: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).optional().nullable(),
  clubName: z.string().max(150).optional().nullable(),
  instagramUrl: SocialUrl,
  youtubeUrl: SocialUrl,
  twitterUrl: SocialUrl,
  facebookUrl: SocialUrl,
})

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>

export const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
export const MAX_LOGO_SIZE = 5 * 1024 * 1024 // 5 MB
