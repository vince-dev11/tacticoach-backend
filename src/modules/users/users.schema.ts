import { z } from 'zod'
import { AGE_PROFILES, FORMAT_PROFILES, LEVEL_LABELS } from '../ai/ai.context.js'

// Who the coach works with. Validated against the values we actually ship, so
// a typo is rejected here rather than silently ignored at generation time.
// An empty string clears the field, which is how a coach says "not set".
const enumOrClear = <T extends Record<string, unknown>>(values: T) =>
  z
    .union([
      z.enum(Object.keys(values) as [string, ...string[]]),
      z.literal('').transform(() => null),
    ])
    .optional()
    .nullable()

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
  coachAgeGroup: enumOrClear(AGE_PROFILES),
  coachFormat: enumOrClear(FORMAT_PROFILES),
  coachLevel: enumOrClear(LEVEL_LABELS),
})

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>

export const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
export const MAX_LOGO_SIZE = 5 * 1024 * 1024 // 5 MB
