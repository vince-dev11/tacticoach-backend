// Tactical brief: concept cards, area model, board-aware placement and the
// self-consistency validators (drawing vs the model's own stated plan).

import { describe, it, expect } from 'vitest'
import { conceptFor, areaRect, areaBounds, CONCEPTS, DEFAULT_BOARD } from '../src/modules/ai/ai.concepts.js'
import { validateBrief } from '../src/modules/ai/ai.validate.js'
import { animationSystemPrompt, layoutSystemPrompt } from '../src/modules/ai/ai.prompts.js'
import { BriefSchema, sanitiseObjects, type CleanItem } from '../src/modules/ai/ai.schema.js'

const p = (ref: string, x: number, y: number): CleanItem => ({
  ref, key: 'player_blue', type: 'player', x, y, props: { label: '9' },
})

describe('concept cards', () => {
  it('recognises concepts in several languages', () => {
    expect(conceptFor('quick counter attack down the right')?.id).toBe('counter_attack')
    expect(conceptFor('contraataque rápido')?.id).toBe('counter_attack')
    expect(conceptFor('rondo 4v2 one touch')?.id).toBe('rondo')
    expect(conceptFor('presión alta')?.id).toBe('high_press')
    expect(conceptFor('salida de balón desde el portero')?.id).toBe('build_up')
    expect(conceptFor('attacking corner routine')?.id).toBe('set_piece_corner')
    expect(conceptFor('something totally unrelated')).toBeNull()
  })

  it('every card is complete and sane', () => {
    for (const c of CONCEPTS) {
      expect(c.how.length).toBeGreaterThanOrEqual(3)
      expect(c.avoid.length).toBeGreaterThanOrEqual(1)
      expect(c.attackers[0]).toBeLessThanOrEqual(c.attackers[1])
      expect(c.defenders[0]).toBeLessThanOrEqual(c.defenders[1])
    }
  })

  it('rondo is a small grid, corners live in the box', () => {
    expect(conceptFor('rondo 5v2')?.area).toBe('grid_small')
    expect(conceptFor('corner kick routine')?.area).toBe('penalty_box')
  })
})

describe('areas scale to the caller board', () => {
  it('resolves fractions against any board size', () => {
    const small = areaRect('grid_small', { width: 700, height: 360 })
    const big = areaRect('grid_small', { width: 1400, height: 720 })
    expect(big.x).toBe(small.x * 2)
    expect(big.h).toBe(small.h * 2)
  })

  it('portrait boards keep areas inside bounds', () => {
    const board = { width: 720, height: 1400 }
    for (const a of ['full_pitch', 'penalty_box', 'grid_small'] as const) {
      const r = areaRect(a, board)
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(board.width)
      expect(r.y + r.h).toBeLessThanOrEqual(board.height)
    }
  })

  it('bounds render as readable text', () => {
    expect(areaBounds('full_pitch', DEFAULT_BOARD)).toMatch(/x \d+–\d+, y \d+–\d+/)
  })
})

describe('prompts carry the brief + board', () => {
  it('injects the matched concept card', () => {
    const sys = animationSystemPrompt('rondo 4v2 with one-touch passing')
    expect(sys).toContain('Rondo')
    expect(sys).toContain('grid_small')
    expect(sys).toContain('Step 1 — write the brief BEFORE any coordinates')
  })

  it('adapts every dimension to the caller board', () => {
    const sys = layoutSystemPrompt('4-3-3 shape', { width: 2000, height: 1000 })
    expect(sys).toContain('2000 wide × 1000 tall')
    expect(sys).toContain('Halfway line is x=1000')
    expect(sys).not.toContain('1400 (right)')
  })

  it('falls back gracefully for unknown concepts', () => {
    expect(animationSystemPrompt('something unusual')).toContain('Unrecognised concept')
  })
})

describe('board-aware sanitisation', () => {
  it('clamps to the caller board, not the default', () => {
    const objs = sanitiseObjects(
      [{ key: 'player_blue', type: 'player', x: 1300, y: 690 }],
      { width: 700, height: 360 },
    )
    expect(objs[0].x).toBeLessThanOrEqual(660)
    expect(objs[0].y).toBeLessThanOrEqual(320)
  })
})

describe('validateBrief — self-consistency', () => {
  const brief = (over: Partial<import('../src/modules/ai/ai.schema.js').Brief> = {}) =>
    BriefSchema.parse({
      concept: 'counter_attack', area: 'full_pitch', attackers: 3, defenders: 2,
      phases: ['regain', 'release', 'finish'], roles: [{ ref: 'h7', job: 'sprints the wing' }],
      ...over,
    })

  it('accepts a drawing that matches its plan', () => {
    const objects = [p('h7', 300, 200), p('h9', 500, 300), p('h6', 400, 400), p('a4', 600, 300), p('a5', 700, 400)]
    const frames = [
      { moves: [{ ref: 'h7', to: { x: 500, y: 180 } }] },
      { moves: [{ ref: 'h9', to: { x: 700, y: 300 } }] },
      { moves: [{ ref: 'h7', to: { x: 800, y: 200 } }] },
    ]
    expect(validateBrief(brief(), objects, frames)).toEqual([])
  })

  it('flags a player count that contradicts the brief', () => {
    const objects = Array.from({ length: 14 }, (_, i) => p(`x${i}`, 100 + i * 80, 300))
    expect(validateBrief(brief(), objects, []).join(' ')).toMatch(/promised 3 attackers \+ 2 defenders \(5 players\) but you placed 14/)
  })

  it('flags fewer frames than declared phases', () => {
    const objects = [p('h7', 300, 200), p('h9', 500, 300), p('h6', 400, 400), p('a4', 600, 300), p('a5', 700, 400)]
    const frames = [{ moves: [{ ref: 'h7', to: { x: 500, y: 180 } }] }]
    expect(validateBrief(brief(), objects, frames).join(' ')).toMatch(/lists 3 phases .* only 1 frames/)
  })

  it('flags a named role that does not exist', () => {
    const objects = [p('h9', 500, 300), p('h6', 400, 400), p('a4', 600, 300), p('a5', 700, 400), p('h8', 300, 300)]
    expect(validateBrief(brief(), objects, []).join(' ')).toMatch(/no object with that ref exists/)
  })

  it('flags a named role that never moves', () => {
    const objects = [p('h7', 300, 200), p('h9', 500, 300), p('h6', 400, 400), p('a4', 600, 300), p('a5', 700, 400)]
    const frames = [
      { moves: [{ ref: 'h9', to: { x: 600, y: 300 } }] },
      { moves: [{ ref: 'h9', to: { x: 700, y: 300 } }] },
      { moves: [{ ref: 'h9', to: { x: 800, y: 300 } }] },
    ]
    expect(validateBrief(brief(), objects, frames).join(' ')).toMatch(/"h7" is given the job .* but never moves/)
  })

  it('flags a rondo sprawling outside its declared grid', () => {
    const objects = Array.from({ length: 6 }, (_, i) => p(`x${i}`, 60 + i * 250, 80))
    const issues = validateBrief(
      brief({ concept: 'rondo', area: 'grid_small', attackers: 4, defenders: 2, phases: ['circulate'], roles: [] }),
      objects,
      [],
    )
    expect(issues.join(' ')).toMatch(/chose the area "grid_small".*placed far outside it/)
  })

  it('is a no-op when the model returned no brief (older clients)', () => {
    expect(validateBrief(undefined, [p('h9', 100, 100)], [])).toEqual([])
  })
})
