// DSL compiler invariants: every pattern × every formation × both sides must
// produce animations our own pipeline accepts with ZERO issues. This is the
// "correct by construction" guarantee, checked empirically in CI.

import { describe, it, expect } from 'vitest'
import { compilePattern, type FormationId, type Side } from '../src/modules/ai/ai.dsl.js'
import { PATTERNS, patternById, patternCatalogue } from '../src/modules/ai/ai.patterns.js'
import { validateAnimation } from '../src/modules/ai/ai.validate.js'

const FORMATIONS: FormationId[] = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2']
const SIDES: Side[] = ['right', 'left']

const cases = PATTERNS.flatMap((p) =>
  FORMATIONS.flatMap((f) => SIDES.map((s) => [`${p.id} · ${f} · ${s}`, p.id, f, s] as const)),
)

describe('DSL compiler invariants', () => {
  it.each(cases)('%s compiles clean', (_name, id, formation, side) => {
    const pattern = patternById(id)!
    const { objects, frames } = compilePattern(pattern, formation, side)

    // Contract shape.
    expect(objects.length).toBeGreaterThanOrEqual(3)
    expect(frames.length).toBeGreaterThanOrEqual(2)
    expect(objects.some((o) => o.type === 'football')).toBe(true)
    for (const o of objects) {
      expect(o.x).toBeGreaterThanOrEqual(40)
      expect(o.x).toBeLessThanOrEqual(1360)
      expect(o.y).toBeGreaterThanOrEqual(40)
      expect(o.y).toBeLessThanOrEqual(680)
    }
    for (const f of frames) {
      expect(f.moves.length).toBeGreaterThan(0)
      for (const m of f.moves) {
        expect(m.to.x).toBeGreaterThanOrEqual(40)
        expect(m.to.x).toBeLessThanOrEqual(1360)
        expect(m.to.y).toBeGreaterThanOrEqual(40)
        expect(m.to.y).toBeLessThanOrEqual(680)
      }
    }

    // The full football-validator pipeline must accept compiler output as-is.
    expect(validateAnimation(objects, frames, pattern.description)).toEqual([])
  })

  it('is deterministic', () => {
    const a = compilePattern(patternById('overlap_wing')!, '4-3-3', 'right')
    const b = compilePattern(patternById('overlap_wing')!, '4-3-3', 'right')
    expect(a).toEqual(b)
  })

  it('mirrors sides (left uses the opposite flank)', () => {
    const right = compilePattern(patternById('overlap_wing')!, '4-3-3', 'right')
    const left = compilePattern(patternById('overlap_wing')!, '4-3-3', 'left')
    const wingRight = right.objects.find((o) => o.ref === 'h_rw')
    const wingLeft = left.objects.find((o) => o.ref === 'h_lw')
    expect(wingRight).toBeDefined()
    expect(wingLeft).toBeDefined()
    expect(wingRight!.y).toBeLessThan(360)
    expect(wingLeft!.y).toBeGreaterThan(360)
  })

  it('substitutes missing roles instead of failing (3-5-2 has no winger)', () => {
    const { objects } = compilePattern(patternById('overlap_wing')!, '3-5-2', 'right')
    // W resolves to RWB in 3-5-2 — FB then resolves elsewhere; both exist.
    expect(objects.filter((o) => o.key === 'player_blue').length).toBe(3)
  })

  it('the ball is owned at the end of every frame (by construction)', () => {
    for (const pattern of PATTERNS) {
      const { objects, frames } = compilePattern(pattern, '4-3-3', 'right')
      const pos = new Map(objects.map((o) => [o.ref, { x: o.x, y: o.y }]))
      frames.forEach((f) => {
        for (const m of f.moves) pos.set(m.ref, m.to)
        const bp = pos.get('ball')!
        const nearest = Math.min(
          ...objects.filter((o) => o.type === 'player').map((o) => {
            const p = pos.get(o.ref)!
            return Math.hypot(bp.x - p.x, bp.y - p.y)
          }),
        )
        const inGoalmouth = (bp.x <= 110 || bp.x >= 1290) && bp.y >= 260 && bp.y <= 460
        expect(nearest <= 90 || inGoalmouth).toBe(true)
      })
    }
  })

  it('catalogue lists every pattern', () => {
    const cat = patternCatalogue()
    for (const p of PATTERNS) expect(cat).toContain(`"${p.id}"`)
  })
})
