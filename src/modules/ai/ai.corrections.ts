// ai.corrections — what coaches actually fixed.
//
// Every earlier quality signal we hold is indirect: the tactical score is our
// own validators marking our own homework, and a regenerate click could mean a
// typo, a whim, or curiosity. A correction is direct. The coach looked at what
// we drew, moved the left-back twelve metres deeper, deleted two cones, and
// SAVED it — that is a domain expert telling us precisely where the generation
// was wrong, as a by-product of work they were doing anyway.
//
// The rules that keep this honest and cheap:
//
//   Store the DIFF, never the board. The board is the coach's work and can be
//   confidential session prep; the diff is what changed, which is ours to
//   learn from and is a few hundred bytes.
//
//   Cap everything. A board rebuilt from scratch isn't a correction, it's a
//   rejection — past a certain size the diff carries no signal about our
//   output, so we record the rejection and drop the detail.
//
//   Denormalise the aggregates. "Which concept do coaches fix most?" must be a
//   GROUP BY, not a JSON scan, or nobody will ever run it — and data nobody
//   reads is a lake, not a loop.

import { z } from 'zod'

/** One object the coach moved: where we put it, where they wanted it. */
export const MovedSchema = z.object({
  /** Object type (player/cone/football…) + team hint, e.g. "player_blue". */
  key: z.string().max(40),
  from: z.object({ x: z.number(), y: z.number() }),
  to: z.object({ x: z.number(), y: z.number() }),
})

/** Something the coach added that we didn't think to place, or vice versa. */
export const PresenceSchema = z.object({
  key: z.string().max(40),
  x: z.number(),
  y: z.number(),
})

export const CorrectionDiffSchema = z.object({
  /** Objects whose position the coach changed (beyond the noise threshold). */
  moved: z.array(MovedSchema).max(60),
  added: z.array(PresenceSchema).max(60),
  removed: z.array(PresenceSchema).max(60),
  /** Refs whose ANIMATION PATHS the coach redrew (endpoints changed). */
  redrawnMovements: z.number().int().min(0),
  /** True when the edit was so large we treat it as a rejection, not a fix. */
  rejected: z.boolean(),
})

export type CorrectionDiff = z.infer<typeof CorrectionDiffSchema>

export const CorrectionRequestSchema = z.object({
  /** Metadata of the generation being corrected, echoed back by the editor. */
  source: z.enum(['dsl', 'gemini']),
  concept: z.string().max(40).catch('unknown'),
  quality: z.number().int().min(0).max(100).catch(0),
  promptHash: z.string().max(16).optional(),
  context: z.string().max(40).optional(),
  diff: CorrectionDiffSchema,
})

export type CorrectionRequest = z.infer<typeof CorrectionRequestSchema>

/** Aggregates stored beside the diff so the summary never opens the JSON. */
export function correctionAggregates(diff: CorrectionDiff): {
  movedCount: number
  addedCount: number
  removedCount: number
  meanShift: number
} {
  const shifts = diff.moved.map((m) => Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y))
  return {
    movedCount: diff.moved.length,
    addedCount: diff.added.length,
    removedCount: diff.removed.length,
    meanShift: shifts.length > 0 ? Math.round(shifts.reduce((a, b) => a + b, 0) / shifts.length) : 0,
  }
}

/**
 * Is this correction worth keeping at all?
 *
 * An untouched save teaches nothing (and is already counted as approval by its
 * absence). A total rebuild teaches nothing about THIS generation either —
 * only that the coach walked away, which `rejected` records without the noise.
 */
export function isWorthKeeping(diff: CorrectionDiff): boolean {
  return (
    diff.rejected ||
    diff.moved.length > 0 ||
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.redrawnMovements > 0
  )
}
