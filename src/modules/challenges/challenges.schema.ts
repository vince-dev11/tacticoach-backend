import { z } from 'zod'
import { BOARD_TAGS } from '../canvas/canvas.routes.js'

/** Owner-authored, one per week. `tag` reuses the board tag enum so a
 *  challenge card can share the same colour/label as the boards it produces. */
export const CreateChallengeSchema = z.object({
  title: z.string().min(1).max(150),
  prompt: z.string().min(1).max(2000),
  tag: z.enum(BOARD_TAGS).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
}).refine((v) => v.endsAt > v.startsAt, {
  message: 'endsAt must be after startsAt',
  path: ['endsAt'],
})

export const SubmitBoardSchema = z.object({
  boardId: z.coerce.number().int().positive(),
})
