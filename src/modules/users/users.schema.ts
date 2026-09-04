import { z } from 'zod'
import {
  AGE_PROFILES, FORMAT_PROFILES, LEVEL_LABELS, FORMATIONS_BY_FORMAT,
} from '../ai/ai.context.js'

const ALL_FORMATIONS = [...new Set(Object.values(FORMATIONS_BY_FORMAT).flat())]

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
  // Formation is validated against the FORMAT at generation time (a saved
  // 4-3-3 is silently ignored during a 7v7 session), so here it only needs to
  // be one of the shapes we ship at all.
  coachFormation: z
    .union([
      z.enum(ALL_FORMATIONS as [string, ...string[]]),
      z.literal('').transform(() => null),
    ])
    .optional()
    .nullable(),
  coachSquadSize: z
    .union([z.number().int().min(2).max(40), z.null()])
    .optional(),
})

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>

/**
 * Guided tours a user can complete. An enum (not a free string) so a client
 * bug can never grow the account's tours array with junk.
 */
export const TOUR_IDS = ['editor', 'sheet', 'session'] as const
export const TourDoneSchema = z.object({ tour: z.enum(TOUR_IDS) })
export type TourId = (typeof TOUR_IDS)[number]

export const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
export const MAX_LOGO_SIZE = 5 * 1024 * 1024 // 5 MB

/**
 * "My Squad" — the coach's real players. Saved as a whole list (replace-all),
 * capped at 30: big enough for any squad + trialists, small enough that a
 * client bug can't flood the table.
 */
export const SQUAD_POSITIONS = ['GK', 'DF', 'MF', 'FW'] as const
export const SaveSquadSchema = z.object({
  players: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        number: z.string().trim().min(1).max(3),
        position: z.enum(SQUAD_POSITIONS).optional().nullable(),
      }),
    )
    .max(30),
})
export type SaveSquadInput = z.infer<typeof SaveSquadSchema>
