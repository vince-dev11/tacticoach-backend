// AI quality evals — real prompts against real Gemini, scored with programmatic
// assertions. Run whenever a prompt or model changes:
//
//   GEMINI_API_KEY=... npm run eval            (all cases)
//   GEMINI_API_KEY=... npm run eval -- layout  (one kind: layout|animation|reel)
//
// A case passes when the pipeline (schema parse → sanitise → football
// validation) accepts the output AND the case's own assertions hold. Exit code
// is 1 below the 80% pass bar, so this can gate CI when you're ready.

import 'dotenv/config'
import { generateTacticsJson } from '../src/config/gemini.js'
import { layoutSystemPrompt, animationSystemPrompt, reelCopySystemPrompt, userPrompt } from '../src/modules/ai/ai.prompts.js'
import {
  LayoutOutputSchema,
  AnimationOutputSchema,
  ReelCopyOutputSchema,
  layoutResponseSchema,
  animationResponseSchema,
  reelCopyResponseSchema,
  sanitiseObjects,
  sanitiseFrames,
  type CleanItem,
} from '../src/modules/ai/ai.schema.js'
import { validateLayout, validateAnimation, validateReelCopy } from '../src/modules/ai/ai.validate.js'

type Kind = 'layout' | 'animation' | 'reel'
interface Case {
  kind: Kind
  name: string
  prompt: string
  /** Extra assertions on the ACCEPTED output. Return issues (empty = pass). */
  assert?: (out: never) => string[]
}

const players = (objs: CleanItem[]) => objs.filter((o) => o.type === 'player')
const langWords = (summary: string, words: string[]) =>
  words.some((w) => summary.toLowerCase().includes(w)) ? [] : [`summary not in expected language: "${summary.slice(0, 80)}"`]

const CASES: Case[] = [
  // ---- Layouts: formations -------------------------------------------------
  { kind: 'layout', name: '4-4-2 full team', prompt: '4-4-2 mid block, full team',
    assert: (o: { objects: CleanItem[] }) => (players(o.objects).length >= 10 ? [] : ['fewer than 10 players']) },
  { kind: 'layout', name: '4-3-3 high press', prompt: '4-3-3 with a high press and aggressive full-backs' },
  { kind: 'layout', name: '3-5-2 wingbacks', prompt: '3-5-2 with attacking wingbacks' },
  { kind: 'layout', name: '4-2-3-1 double pivot', prompt: '4-2-3-1 with a double pivot protecting the back four' },
  { kind: 'layout', name: '5-4-1 low block', prompt: '5-4-1 low block, compact lines' },
  { kind: 'layout', name: 'both teams', prompt: '4-3-3 attacking against a 4-4-2 defending — show both teams',
    assert: (o: { objects: CleanItem[] }) => (players(o.objects).length >= 18 ? [] : ['expected two full-ish teams']) },
  // ---- Layouts: drills & set pieces ---------------------------------------
  { kind: 'layout', name: 'rondo 4v2', prompt: 'rondo 4v2 in a tight square with cones',
    assert: (o: { objects: CleanItem[] }) => {
      const issues: string[] = []
      if (players(o.objects).length < 6) issues.push('a 4v2 rondo needs 6 players')
      if (!o.objects.some((x) => x.type !== 'player' && x.type !== 'football')) issues.push('no cones/markers placed')
      return issues
    } },
  { kind: 'layout', name: 'corner routine', prompt: 'attacking corner from the right: near-post flick, back-post runner',
    assert: (o: { objects: CleanItem[] }) => {
      const ball = o.objects.find((x) => x.type === 'football')
      if (!ball) return ['no ball on a corner routine']
      const nearCorner = (ball.x < 180 || ball.x > 1220) && (ball.y < 180 || ball.y > 540)
      return nearCorner ? [] : [`ball at (${ball.x},${ball.y}) is not at a corner`]
    } },
  { kind: 'layout', name: 'passing triangle', prompt: 'triangle passing drill for 3 players with two balls' },
  { kind: 'layout', name: 'finishing drill', prompt: 'finishing drill: crosses from both wings, two strikers, one goalkeeper' },
  // ---- Layouts: languages --------------------------------------------------
  { kind: 'layout', name: 'Spanish prompt → Spanish summary', prompt: 'presión alta en 4-3-3 contra salida de balón rival',
    assert: (o: { summary: string }) => langWords(o.summary, [' la ', ' el ', 'presión', ' de ', ' los ']) },
  { kind: 'layout', name: 'German prompt → German summary', prompt: 'hohes Pressing im 4-3-3 gegen tiefen Block',
    assert: (o: { summary: string }) => langWords(o.summary, [' der ', ' die ', ' und ', 'pressing', ' mit ']) },
  { kind: 'layout', name: 'French prompt → French summary', prompt: 'pressing haut en 4-3-3 contre un bloc bas',
    assert: (o: { summary: string }) => langWords(o.summary, [' le ', ' les ', ' des ', ' avec ', 'pressing']) },
  { kind: 'layout', name: 'Italian prompt → Italian summary', prompt: 'pressing alto in 4-3-3 contro blocco basso',
    assert: (o: { summary: string }) => langWords(o.summary, [' il ', ' con ', ' di ', 'pressing', ' della ']) },
  { kind: 'layout', name: 'Turkish prompt → Turkish summary', prompt: 'alçak bloka karşı 4-3-3 yüksek pres',
    assert: (o: { summary: string }) => langWords(o.summary, ['pres', ' ve ', ' ile ', 'oyun']) },
  { kind: 'layout', name: 'Polish prompt → Polish summary', prompt: 'wysoki pressing w ustawieniu 4-3-3 przeciwko niskiemu blokowi',
    assert: (o: { summary: string }) => langWords(o.summary, [' w ', ' na ', 'pressing', ' z ', ' i ']) },
  // ---- Animations ----------------------------------------------------------
  { kind: 'animation', name: 'counter attack', prompt: 'fast counter attack from a turnover in midfield, 3 phases',
    assert: (o: { frames: unknown[] }) => (o.frames.length >= 2 ? [] : ['a 3-phase counter needs ≥2 frames']) },
  { kind: 'animation', name: 'build-up', prompt: 'tiki-taka build-up from the goalkeeper through the thirds' },
  { kind: 'animation', name: 'overlap', prompt: 'left-back overlap: winger cuts inside, full-back takes the wide lane' },
  { kind: 'animation', name: 'press trap', prompt: 'pressing trap on the touchline: force the pass wide then swarm' },
  { kind: 'animation', name: 'ball moves', prompt: 'switch of play from left to right with a long diagonal',
    assert: (o: { objects: CleanItem[]; frames: { moves: { ref: string }[] }[] }) => {
      const ball = o.objects.find((x) => x.type === 'football')
      if (!ball) return ['no ball in a passing move']
      const ballMoves = o.frames.some((f) => f.moves.some((m) => m.ref === ball.ref))
      return ballMoves ? [] : ['the ball never moves in a switch-of-play animation']
    } },
  { kind: 'animation', name: 'Spanish animation', prompt: 'contraataque rápido por la banda derecha en tres fases',
    assert: (o: { summary: string }) => langWords(o.summary, [' la ', ' el ', ' de ', 'contra', ' por ']) },
  { kind: 'animation', name: 'German animation', prompt: 'schneller Konter über die rechte Seite in drei Phasen',
    assert: (o: { summary: string }) => langWords(o.summary, [' der ', ' die ', ' über ', ' und ', 'konter']) },
  // ---- Reel copy -----------------------------------------------------------
  { kind: 'reel', name: 'reel: high press', prompt: JSON.stringify({ boardTitle: 'High press buildup', notes: 'trap the fullback, win it in 6 seconds', objects: 22, frames: 3 }) },
  { kind: 'reel', name: 'reel: rondo', prompt: JSON.stringify({ boardTitle: 'Rondo 4v2 intensity', notes: 'one-touch under pressure', objects: 8, frames: 2 }) },
  { kind: 'reel', name: 'reel: Spanish', prompt: JSON.stringify({ boardTitle: 'Presión tras pérdida', notes: 'recuperar en 5 segundos', objects: 22, frames: 3 }),
    assert: (o: { title: string; quote: string }) => langWords(`${o.title} ${o.quote}`, ['presión', ' la ', ' el ', ' de ', ' en ']) },
  { kind: 'reel', name: 'reel: German', prompt: JSON.stringify({ boardTitle: 'Gegenpressing nach Ballverlust', notes: 'Ball in 5 Sekunden zurückerobern', objects: 22, frames: 3 }),
    assert: (o: { title: string; quote: string }) => langWords(`${o.title} ${o.quote}`, [' der ', ' die ', ' nach ', 'ball', ' in ']) },
  { kind: 'reel', name: 'reel: title length', prompt: JSON.stringify({ boardTitle: 'A very long and rambling session name that goes on and on about pressing', notes: '', objects: 10, frames: 2 }),
    assert: (o: { title: string }) => (o.title.length <= 40 ? [] : [`title too long for the template: ${o.title.length} chars`]) },
]

async function runCase(c: Case): Promise<{ pass: boolean; detail: string }> {
  try {
    if (c.kind === 'layout') {
      const raw = await generateTacticsJson(layoutSystemPrompt(), userPrompt(c.prompt), { responseSchema: layoutResponseSchema, temperature: 0.5 })
      const parsed = LayoutOutputSchema.safeParse(raw)
      if (!parsed.success) return { pass: false, detail: 'schema parse failed' }
      const objects = sanitiseObjects(parsed.data.objects)
      const issues = [
        ...validateLayout(objects, c.prompt),
        ...(c.assert?.({ objects, summary: parsed.data.summary } as never) ?? []),
      ]
      return { pass: issues.length === 0, detail: issues.join('; ') || 'ok' }
    }
    if (c.kind === 'animation') {
      const raw = await generateTacticsJson(animationSystemPrompt(), userPrompt(c.prompt), { responseSchema: animationResponseSchema, temperature: 0.5 })
      const parsed = AnimationOutputSchema.safeParse(raw)
      if (!parsed.success) return { pass: false, detail: 'schema parse failed' }
      const objects = sanitiseObjects(parsed.data.objects)
      const frames = sanitiseFrames(parsed.data.frames, objects)
      const issues = [
        ...validateAnimation(objects, frames, c.prompt),
        ...(c.assert?.({ objects, frames, summary: parsed.data.summary } as never) ?? []),
      ]
      return { pass: issues.length === 0, detail: issues.join('; ') || 'ok' }
    }
    const raw = await generateTacticsJson(reelCopySystemPrompt(), c.prompt, { responseSchema: reelCopyResponseSchema, temperature: 0.5 })
    const parsed = ReelCopyOutputSchema.safeParse(raw)
    if (!parsed.success) return { pass: false, detail: 'schema parse failed' }
    const issues = [...validateReelCopy(parsed.data), ...(c.assert?.(parsed.data as never) ?? [])]
    return { pass: issues.length === 0, detail: issues.join('; ') || 'ok' }
  } catch (err) {
    return { pass: false, detail: `error: ${(err as Error).message.slice(0, 120)}` }
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.log('GEMINI_API_KEY not set — evals need a real key. Nothing run.')
    return
  }
  const only = process.argv[2] as Kind | undefined
  const cases = only ? CASES.filter((c) => c.kind === only) : CASES
  console.log(`Running ${cases.length} eval case(s) against ${process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'}…\n`)

  let passed = 0
  for (const c of cases) {
    const { pass, detail } = await runCase(c)
    passed += pass ? 1 : 0
    console.log(`${pass ? '✅' : '❌'}  [${c.kind}] ${c.name}${pass ? '' : ` — ${detail}`}`)
    await new Promise((r) => setTimeout(r, 1200)) // stay inside free-tier RPM
  }

  const rate = Math.round((passed / cases.length) * 100)
  console.log(`\n${passed}/${cases.length} passed (${rate}%)`)
  if (rate < 80) {
    console.log('Below the 80% bar — inspect the failures before shipping prompt changes.')
    process.exit(1)
  }
}

void main()
