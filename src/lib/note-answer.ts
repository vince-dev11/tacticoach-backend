// PLAYER-ANSWER (29 Oct 2026, owner): what a player may answer on the move a
// coach sent with a note. Structured only — a placed run (where they think
// the spotlit player goes, board units) or one of up to three choices. Never
// free text: a child answering an adult in words is a surface this product
// does not want (see PlayerNote.acknowledgedAt).
import { z } from 'zod'

export const noteAnswerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('place'),
    /** The movement frame the question belongs to (1 = the first move). */
    frame: z.number().int().min(1).max(200),
    /** Where the player put the ghost, board units. */
    x: z.number().min(-5000).max(5000),
    y: z.number().min(-5000).max(5000),
  }),
  z.object({
    kind: z.literal('choice'),
    frame: z.number().int().min(1).max(200),
    pick: z.enum(['a', 'b', 'c']),
  }),
])

export type NoteAnswer = z.infer<typeof noteAnswerSchema>

/** Read a stored answer defensively (an older or hand-edited row must not throw). */
export function noteAnswerOf(v: unknown): NoteAnswer | null {
  const r = noteAnswerSchema.safeParse(v)
  return r.success ? r.data : null
}
