// Football principles: are the geometric measurements right, and does the
// tactical score reflect real animation quality?

import { describe, it, expect } from 'vitest'
import { CONCEPTS, conceptFor, PRINCIPLE_LABELS, type PrincipleId } from '../src/modules/ai/ai.concepts.js'
import { validatePrinciples, tacticalScore, principleIssues } from '../src/modules/ai/ai.validate.js'
import { animationSystemPrompt } from '../src/modules/ai/ai.prompts.js'
import type { CleanItem } from '../src/modules/ai/ai.schema.js'

const blue = (ref: string, x: number, y: number): CleanItem => ({ ref, key: 'player_blue', type: 'player', x, y })
const red = (ref: string, x: number, y: number): CleanItem => ({ ref, key: 'player_red', type: 'player', x, y })
const ball = (x: number, y: number): CleanItem => ({ ref: 'ball', key: 'white_ball', type: 'football', x, y })
const only = (ids: PrincipleId[], objects: CleanItem[], frames: { moves: { ref: string; to: { x: number; y: number } }[] }[]) =>
  Object.fromEntries(validatePrinciples(ids, objects, frames).map((r) => [r.id, r.present]))

describe('concept cards carry principles, problem and arc', () => {
  it('every card is complete', () => {
    for (const c of CONCEPTS) {
      expect(c.principles.length, `${c.id} principles`).toBeGreaterThanOrEqual(2)
      expect(c.problem.length, `${c.id} problem`).toBeGreaterThan(20)
      expect(c.arc.length, `${c.id} arc`).toBeGreaterThanOrEqual(4)
      for (const pid of c.principles) expect(PRINCIPLE_LABELS[pid], `${c.id} → ${pid}`).toBeTruthy()
    }
  })

  it('counter attack demands forward play, depth and speed', () => {
    const c = conceptFor('quick counter attack')!
    expect(c.principles).toContain('forward_play')
    expect(c.principles).toContain('depth')
    expect(c.principles).toContain('speed')
  })

  it('the prompt shows the problem, the principles and the arc', () => {
    const sys = animationSystemPrompt('counter attack down the right')
    expect(sys).toContain('The football PROBLEM this scenario must pose')
    expect(sys).toContain('Principles that MUST be visible')
    expect(sys).toContain('Narrative arc')
    expect(sys).toContain('immediate forward play')
  })
})

describe('principle measurements', () => {
  it('forward_play: rewards an attacking first action, flags a backward one', () => {
    const objects = [blue('h6', 600, 360), blue('h9', 900, 360), red('a4', 800, 360), ball(610, 360)]
    const forward = [{ moves: [{ ref: 'ball', to: { x: 900, y: 360 } }] }]
    const backward = [{ moves: [{ ref: 'ball', to: { x: 300, y: 360 } }] }]
    expect(only(['forward_play'], objects, forward).forward_play).toBe(true)
    // A backwards first action with net backward travel is not forward play.
    expect(validatePrinciples(['forward_play'], objects, backward)[0].present).toBe(false)
  })

  it('penetration: measures net ball progress', () => {
    const objects = [blue('h9', 300, 360), red('a4', 800, 360), ball(310, 360)]
    const far = [{ moves: [{ ref: 'ball', to: { x: 1200, y: 360 } }] }]
    const near = [{ moves: [{ ref: 'ball', to: { x: 380, y: 360 } }] }]
    expect(only(['penetration'], objects, far).penetration).toBe(true)
    expect(only(['penetration'], objects, near).penetration).toBe(false)
  })

  it('depth: needs someone beyond the deepest defender', () => {
    const objects = [blue('h9', 700, 360), red('a4', 900, 360), ball(710, 360)]
    const beyond = [{ moves: [{ ref: 'h9', to: { x: 1100, y: 360 } }, { ref: 'ball', to: { x: 1110, y: 360 } }] }]
    const short = [{ moves: [{ ref: 'h9', to: { x: 850, y: 360 } }, { ref: 'ball', to: { x: 860, y: 360 } }] }]
    expect(only(['depth'], objects, beyond).depth).toBe(true)
    expect(only(['depth'], objects, short).depth).toBe(false)
  })

  it('support: flags an isolated ball carrier', () => {
    const alone = [blue('h9', 1200, 360), blue('h6', 200, 360), ball(1210, 360)]
    const supported = [blue('h9', 1200, 360), blue('h10', 1100, 300), blue('h7', 1050, 420), ball(1210, 360)]
    const frames = [{ moves: [{ ref: 'ball', to: { x: 1215, y: 360 } }] }]
    expect(only(['support'], alone, frames).support).toBe(false)
    expect(only(['support'], supported, frames).support).toBe(true)
  })

  it('overload: counts bodies around the ball', () => {
    const objects = [
      blue('h9', 1100, 340), blue('h7', 1050, 300), blue('h10', 1150, 400),
      red('a4', 1120, 360), ball(1110, 350),
    ]
    const frames = [{ moves: [{ ref: 'ball', to: { x: 1115, y: 355 } }] }]
    expect(only(['overload'], objects, frames).overload).toBe(true)
  })

  it('speed: long sequences are not quick', () => {
    const objects = [blue('h9', 300, 360), ball(310, 360)]
    const six = Array.from({ length: 6 }, (_, i) => ({ moves: [{ ref: 'h9', to: { x: 320 + i * 60, y: 360 } }] }))
    expect(only(['speed'], objects, six.slice(0, 3)).speed).toBe(true)
    expect(only(['speed'], objects, six).speed).toBe(false)
  })

  it('pressing_trigger: pressure must close as the ball travels', () => {
    const objects = [blue('h9', 600, 360), red('a4', 1000, 360), ball(1010, 360)]
    const closing = [
      { moves: [{ ref: 'ball', to: { x: 950, y: 400 } }] },
      { moves: [{ ref: 'h9', to: { x: 880, y: 390 } }] },
    ]
    const passive = [
      { moves: [{ ref: 'ball', to: { x: 950, y: 400 } }] },
      { moves: [{ ref: 'h9', to: { x: 400, y: 360 } }] },
    ]
    expect(only(['pressing_trigger'], objects, closing).pressing_trigger).toBe(true)
    expect(only(['pressing_trigger'], objects, passive).pressing_trigger).toBe(false)
  })

  it('compactness: a stretched unit fails', () => {
    const tight = Array.from({ length: 6 }, (_, i) => blue(`h${i}`, 300 + (i % 2) * 90, 250 + Math.floor(i / 2) * 110))
    const stretched = Array.from({ length: 6 }, (_, i) => blue(`h${i}`, 100 + i * 240, 60 + i * 110))
    const frames = [{ moves: [{ ref: 'h0', to: { x: 320, y: 260 } }] }]
    expect(only(['compactness'], tight, frames).compactness).toBe(true)
    expect(only(['compactness'], stretched, frames).compactness).toBe(false)
  })
})

describe('tactical score', () => {
  it('scores 100 when everything is present and 0 when nothing is', () => {
    expect(tacticalScore([
      { id: 'width', present: true, detail: '' },
      { id: 'depth', present: true, detail: '' },
    ])).toBe(100)
    expect(tacticalScore([
      { id: 'width', present: false, detail: '' },
      { id: 'depth', present: false, detail: '' },
    ])).toBe(0)
    expect(tacticalScore([
      { id: 'width', present: true, detail: '' },
      { id: 'depth', present: false, detail: '' },
      { id: 'speed', present: false, detail: '' },
      { id: 'support', present: true, detail: '' },
    ])).toBe(50)
  })

  it('turns missing principles into coachable retry feedback', () => {
    const issues = principleIssues([
      { id: 'depth', present: false, detail: 'nobody runs beyond the last defender' },
      { id: 'width', present: true, detail: 'fine' },
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('depth')
    expect(issues[0]).toContain('nobody runs beyond')
  })

  it('a good counter attack scores well, a flat one scores poorly', () => {
    const ids = conceptFor('counter attack')!.principles
    const objects = [
      blue('h6', 500, 380), blue('h7', 620, 160), blue('h9', 700, 380),
      red('a4', 800, 300), red('a5', 850, 430), ball(510, 380),
    ]
    const good = [
      { moves: [{ ref: 'ball', to: { x: 700, y: 375 } }, { ref: 'h7', to: { x: 900, y: 130 } }, { ref: 'h9', to: { x: 880, y: 360 } }] },
      { moves: [{ ref: 'ball', to: { x: 905, y: 135 } }, { ref: 'h9', to: { x: 1080, y: 340 } }, { ref: 'a4', to: { x: 950, y: 320 } }] },
      { moves: [{ ref: 'ball', to: { x: 1150, y: 345 } }, { ref: 'h9', to: { x: 1145, y: 340 } }, { ref: 'h7', to: { x: 1050, y: 200 } }, { ref: 'a5', to: { x: 1000, y: 420 } }] },
    ]
    const flat = [{ moves: [{ ref: 'h6', to: { x: 480, y: 390 } }] }]
    const goodScore = tacticalScore(validatePrinciples(ids, objects, good))
    const flatScore = tacticalScore(validatePrinciples(ids, objects, flat))
    expect(goodScore).toBeGreaterThanOrEqual(66)
    expect(flatScore).toBeLessThan(50)
    expect(goodScore).toBeGreaterThan(flatScore)
  })
})
