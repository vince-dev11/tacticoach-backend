// Validation + sanitisation of Gemini output before it reaches the editor.
// The model is capable but not trusted: coordinates are clamped to the board,
// unknown object types are dropped, refs are made unique, and frame moves that
// reference unknown objects are filtered out.

import { z } from 'zod'
import { CANVAS } from './ai.prompts.js'
import { PATTERN_IDS } from './ai.patterns.js'
import { AREA_IDS, DEFAULT_BOARD, type Board } from './ai.concepts.js'

// Matches the editor's ObjectType union (frontend src/editor/types.ts).
const OBJECT_TYPES = new Set([
  'player', 'football', 'cone', 'cone-half', 'ladder', 'ring', 'pole',
  'mannequine', 'shape-cone', 'hurdle', 'goal', 'pitch', 'text',
  'circle', 'rectangle', 'square', 'triangle', 'line', 'dashedline',
])

const PAD = 40
// Board-aware clamps: the caller (editor) passes its actual board size, so
// coordinates land correctly on landscape, portrait or custom boards.
const clampTo = (v: number, max: number) => Math.min(Math.max(Math.round(v), PAD), max - PAD)
const clampX = (v: number, board: Board = DEFAULT_BOARD) => clampTo(v, board.width)
const clampY = (v: number, board: Board = DEFAULT_BOARD) => clampTo(v, board.height)

export const RequestSchema = z.object({
  prompt: z.string().min(3).max(1000),
  generation_mode: z.string().optional(), // accepted for wire-compat, unused
  // Editor board size. Optional for wire-compat; defaults to the 1400×720
  // design space every existing client uses.
  board: z
    .object({
      width: z.number().min(400).max(4000),
      height: z.number().min(300).max(4000),
    })
    .optional(),
  // Who this session is for. Optional at every level: absent means "use my
  // saved profile", and an absent profile means senior 11-a-side. Unknown
  // values are dropped rather than rejected, so an older client that sends
  // nothing — or a newer one that sends an age we haven't shipped yet — still
  // generates instead of 400-ing.
  context: z
    .object({
      age: z.string().optional(),
      format: z.string().optional(),
      level: z.string().optional(),
    })
    .optional(),
})

/** The model's pre-drawing plan: what it decided BEFORE placing anything. */
export const BriefSchema = z.object({
  concept: z.string().max(60).catch(''),
  area: z.string().max(40).catch('full_pitch'),
  /** The football problem the scenario poses — no problem, no learning. */
  problem: z.string().max(240).catch(''),
  /** Principles the animation claims to demonstrate; each is measured. */
  principles: z.array(z.string().max(40)).max(8).catch([]),
  attackers: z.number().int().min(0).max(11).catch(0),
  defenders: z.number().int().min(0).max(11).catch(0),
  phases: z.array(z.string().max(140)).max(8).catch([]),
  roles: z
    .array(z.object({ ref: z.string().max(40), job: z.string().max(160) }))
    .max(24)
    .catch([]),
})
export type Brief = z.infer<typeof BriefSchema>

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

// NOTE ON KEY ORDER: generation is left-to-right, so "brief" is declared FIRST
// — the model commits to its plan (concept, area, counts, roles, phases) before
// it writes a single coordinate, and everything after is conditioned on it.
// Optional + .catch so older clients/outputs without a brief still parse.
export const LayoutOutputSchema = z.object({
  brief: BriefSchema.optional().catch(undefined),
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
export function sanitiseObjects(
  items: z.infer<typeof ItemSchema>[],
  board: Board = DEFAULT_BOARD,
): CleanItem[] {
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
      x: clampX(item.x, board),
      y: clampY(item.y, board),
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
  board: Board = DEFAULT_BOARD,
): { moves: { ref: string; to: { x: number; y: number } }[] }[] {
  const refs = new Set(objects.map((o) => o.ref))
  return frames
    .map((f) => ({
      moves: f.moves
        .filter((m) => refs.has(m.ref))
        .slice(0, 20)
        .map((m) => ({ ref: m.ref, to: { x: clampX(m.to.x, board), y: clampY(m.to.y, board) } })),
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
  bool: { type: 'BOOLEAN' },
  strEnum: (...values: string[]) => ({ type: 'STRING', enum: values }),
}

// ---- DSL plan (symbolic tactical plan — the model picks, the compiler draws) --

export const PlanSchema = z.object({
  fallback: z.boolean().catch(true),
  pattern: z.string().optional(),
  side: z.enum(['right', 'left']).catch('right'),
  formation: z.enum(['4-3-3', '4-4-2', '4-2-3-1', '3-5-2']).catch('4-3-3'),
  summary: z.string().min(1).max(2000).catch('Tactical animation generated.'),
})
export type Plan = z.infer<typeof PlanSchema>

/** Constrained decoding: pattern ids are an enum — hallucinated patterns are
 *  impossible on the Gemini path. */
export const planResponseSchema = G.obj(
  {
    fallback: G.bool,
    pattern: G.strEnum(...PATTERN_IDS),
    side: G.strEnum('right', 'left'),
    formation: G.strEnum('4-3-3', '4-4-2', '4-2-3-1', '3-5-2'),
    summary: G.str,
  },
  ['fallback', 'summary'],
)

const gItem = G.obj(
  {
    ref: G.str,
    key: G.str,
    type: G.str,
    x: G.num,
    y: G.num,
    // label for players; the rest allow optional zone rectangles (width/height/
    // stroke) and text labels (text/fill/fontSize) — see layout prompt.
    props: G.obj(
      {
        label: G.str,
        text: G.str,
        width: G.num,
        height: G.num,
        stroke: G.str,
        strokeWidth: G.num,
        fill: G.str,
        fontSize: G.num,
      },
      [],
    ),
  },
  ['key', 'type', 'x', 'y'],
)

// Brief first — constrained decoding follows property order, so the model is
// forced to state its plan before it may emit a single coordinate.
const gBrief = G.obj(
  {
    concept: G.str,
    area: G.strEnum(...AREA_IDS),
    problem: G.str,
    principles: G.arr(G.str),
    attackers: G.num,
    defenders: G.num,
    phases: G.arr(G.str),
    roles: G.arr(G.obj({ ref: G.str, job: G.str }, ['ref', 'job'])),
  },
  ['area', 'problem', 'principles', 'attackers', 'defenders', 'phases'],
)

export const layoutResponseSchema = G.obj(
  { brief: gBrief, summary: G.str, objects: G.arr(gItem) },
  ['brief', 'summary', 'objects'],
)

export const animationResponseSchema = G.obj(
  {
    brief: gBrief,
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
