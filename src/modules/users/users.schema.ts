import { z } from 'zod'
import { latinOnly } from '../../lib/latin-only.js'
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
  name: latinOnly(z.string().min(1).max(100)).optional(),
  surname: latinOnly(z.string().min(1).max(100)).optional(),
  /// Correctable after signup — someone who signed up solo and later runs a
  /// club should be able to say so. Still grants nothing on its own.
  accountType: z.enum(['coach', 'club', 'player']).optional(),
  phone: z.string().max(30).optional().nullable(),
  clubName: latinOnly(z.string().max(150)).optional().nullable(),
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
export const TOUR_IDS = ['editor', 'sheet', 'session', 'book'] as const
/**
 * "What's new" pop-ups are recorded the same way, as `release:YYYY-MM-DD` —
 * one entry per release the account has seen, so a coach sees each release
 * once across every device. The date shape is the only free part.
 */
export const RELEASE_MARK = /^release:\d{4}-\d{2}-\d{2}$/
export const TourDoneSchema = z.object({
  tour: z.union([z.enum(TOUR_IDS), z.string().regex(RELEASE_MARK)]),
})
export type TourId = (typeof TOUR_IDS)[number] | `release:${string}`

/**
 * Club logo uploads. Raster only, deliberately: an SVG is a script-bearing
 * document, not just a picture — one uploaded with an <script> or onload
 * payload executes in whoever's browser opens the file URL, on our own origin.
 * Every other upload route in the API is already raster-only; this one is now
 * consistent with them.
 */
export const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** Stored file extension per accepted type — never taken from the filename. */
export const EXT_FOR_LOGO_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
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
        /// Present for a row that already exists. Without it the save could
        /// not tell "renamed Marco" from "deleted Marco, added Marc", and the
        /// difference is a player's entire feedback history.
        id: z.number().int().positive().optional(),
        name: z.string().trim().min(1).max(40),
        number: z.string().trim().min(1).max(3),
        position: z.enum(SQUAD_POSITIONS).optional().nullable(),
      }),
    )
    .max(30),
  /// Which team was edited. Optional so an older client keeps working — it
  /// resolves to the coach's default squad, which is the only one that client
  /// knows about anyway.
  squadId: z.number().int().positive().optional().nullable(),
})
export type SaveSquadInput = z.infer<typeof SaveSquadSchema>

/** A team: "U13", "First team", "Thursday keepers". */
export const CreateSquadSchema = z.object({
  name: z.string().trim().min(1).max(60),
  ageGroup: z.string().trim().max(16).optional().nullable(),
})

export const MovePlayerSchema = z.object({
  squadId: z.number().int().positive(),
})
