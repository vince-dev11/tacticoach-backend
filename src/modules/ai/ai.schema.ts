// Validation + sanitisation of Gemini output before it reaches the editor.
// The model is capable but not trusted: coordinates are clamped to the board,
// unknown object types are dropped, refs are made unique, and frame moves that
// reference unknown objects are filtered out.

import { z } from 'zod'
import { CANVAS } from './ai.prompts.js'

// Matches the editor's ObjectType union (frontend src/editor/types.ts).
const OBJECT_TYPES = new Set([
  'player', 'football', 'cone', 'cone-half', 'ladder', 'ring', 'pole',
  'mannequine', 'shape-cone', 'hurdle', 'goal', 'pitch', 'text',
  'circle', 'rectangle', 'square', 'triangle', 'line', 'dashedline',
])

const PAD = 40
const clampX = (v: number) => Math.min(Math.max(Math.round(v), PAD), CANVAS.width - PAD)
const clampY = (v: number) => Math.min(Math.max(Math.round(v), PAD), CANVAS.height - PAD)

export const RequestSchema = z.object({
  prompt: z.string().min(3).max(1000),
  generation_mode: z.string().optional(), // accepted for wire-compat, unused
})

const ItemSchema = z.object({
  ref: z.string().max(40).optional(),
  key: z.string().min(1).max(60),
  type: z.string().min(1).max(30),
  x: z.number(),
  y: z.number(),
  props: z
    .object({ label: z.union([z.string().max(10), z.number().transform((n) => String(n))]).optional() })
    .passthrough()
    .optional(),
  text: z.string().max(200).optional(),
})

const MoveSchema = z.object({
  ref: z.string().max(40),
  to: z.object({ x: z.number(), y: z.number() }),
})

export const LayoutOutputSchema = z.object({
  summary: z.string().min(1).max(2000).catch('Tactical setup generated.'),
  objects: z.array(ItemSchema).min(1).max(60),
})

export const AnimationOutputSchema = LayoutOutputSchema.extend({
  frames: z.array(z.object({ moves: z.array(MoveSchema).max(30).catch([]) })).min(1).max(8),
})

export interface CleanItem {
  ref: string
  key: string
  type: string
  x: number
  y: number
  props?: Record<string, unknown>
  text?: string
}

/** Drop invalid types, clamp coordinates, force unique refs. Max 40 objects. */
export function sanitiseObjects(items: z.infer<typeof ItemSchema>[]): CleanItem[] {
  const seen = new Set<string>()
  const out: CleanItem[] = []
  for (const item of items) {
    if (!OBJECT_TYPES.has(item.type)) continue
    let ref = (item.ref ?? '').trim() || `obj${out.length + 1}`
    while (seen.has(ref)) ref = `${ref}_`
    seen.add(ref)
    out.push({
      ref,
      key: item.key,
      type: item.type,
      x: clampX(item.x),
      y: clampY(item.y),
      ...(item.props ? { props: item.props } : {}),
      ...(item.text ? { text: item.text } : {}),
    })
    if (out.length >= 40) break
  }
  return out
}

/** Keep only moves that target known refs; clamp targets to the board. */
export function sanitiseFrames(
  frames: { moves: { ref: string; to: { x: number; y: number } }[] }[],
  objects: CleanItem[],
): { moves: { ref: string; to: { x: number; y: number } }[] }[] {
  const refs = new Set(objects.map((o) => o.ref))
  return frames
    .map((f) => ({
      moves: f.moves
        .filter((m) => refs.has(m.ref))
        .slice(0, 20)
        .map((m) => ({ ref: m.ref, to: { x: clampX(m.to.x), y: clampY(m.to.y) } })),
    }))
    .filter((f) => f.moves.length > 0)
    .slice(0, 6)
}

// ---- Reel copy (social video templates) ------------------------------------

export const ReelCopyRequestSchema = z.object({
  boardTitle: z.string().max(120).default('Untitled session'),
  prompt: z.string().max(500).optional(),
  objectCount: z.number().int().min(0).max(200).default(0),
  frameCount: z.number().int().min(0).max(50).default(0),
})

export const ReelCopyOutputSchema = z.object({
  title: z.string().min(1).max(60),
  subtitle: z.string().max(80).catch(''),
  quote: z.string().min(1).max(90),
  quoteDetail: z.string().max(120).catch(''),
  stats: z
    .array(z.object({ value: z.string().min(1).max(8), label: z.string().min(1).max(24) }))
    .length(3)
    .catch([
      { value: '4-3-3', label: 'Shape' },
      { value: '3', label: 'Frames' },
      { value: '11v11', label: 'Setup' },
    ]),
  tags: z.array(z.string().min(1).max(14)).length(3).catch(['TACTICS', 'DRILL', 'COACHING']),
  hashtags: z.string().max(90).catch('#football #coaching #tactics'),
})

export type ReelCopy = z.infer<typeof ReelCopyOutputSchema>

// ---- Gemini responseSchema (constrained decoding) ---------------------------
// The Generative Language API's OpenAPI-subset schema format. Constraining the
// output means the model CANNOT emit malformed JSON or missing keys.

const G = {
  obj: (properties: Record<string, unknown>, required: string[]) => ({ type: 'OBJECT', properties, required }),
  arr: (items: unknown) => ({ type: 'ARRAY', items }),
  str: { type: 'STRING' },
  num: { type: 'NUMBER' },
}

const gItem = G.obj(
  {
    ref: G.str,
    key: G.str,
    type: G.str,
    x: G.num,
    y: G.num,
    props: G.obj({ label: G.str }, []),
  },
  ['key', 'type', 'x', 'y'],
)

export const layoutResponseSchema = G.obj(
  { summary: G.str, objects: G.arr(gItem) },
  ['summary', 'objects'],
)

export const animationResponseSchema = G.obj(
  {
    summary: G.str,
    objects: G.arr(gItem),
    frames: G.arr(
      G.obj(
        { moves: G.arr(G.obj({ ref: G.str, to: G.obj({ x: G.num, y: G.num }, ['x', 'y']) }, ['ref', 'to'])) },
        ['moves'],
      ),
    ),
  },
  ['summary', 'objects', 'frames'],
)

export const reelCopyResponseSchema = G.obj(
  {
    title: G.str,
    subtitle: G.str,
    quote: G.str,
    quoteDetail: G.str,
    stats: G.arr(G.obj({ value: G.str, label: G.str }, ['value', 'label'])),
    tags: G.arr(G.str),
    hashtags: G.str,
  },
  ['title', 'subtitle', 'quote', 'quoteDetail', 'stats', 'tags', 'hashtags'],
)
