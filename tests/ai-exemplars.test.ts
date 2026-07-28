// Exemplar library self-check: every worked example we show the model must
// pass our OWN pipeline (schema parse → sanitise → football validators) with
// zero issues — otherwise we'd be teaching the AI patterns we then reject.

import { describe, it, expect } from 'vitest'
import { EXEMPLARS, exemplarFor } from '../src/modules/ai/ai.exemplars.js'
import { animationSystemPrompt } from '../src/modules/ai/ai.prompts.js'
import { AnimationOutputSchema, sanitiseObjects, sanitiseFrames } from '../src/modules/ai/ai.schema.js'
import { validateAnimation } from '../src/modules/ai/ai.validate.js'

describe('exemplar library', () => {
  it('has unique ids', () => {
    const ids = EXEMPLARS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(EXEMPLARS.map((e) => [e.id, e] as const))('"%s" passes the full pipeline', (_id, ex) => {
    const parsed = AnimationOutputSchema.safeParse(ex.example)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const objects = sanitiseObjects(parsed.data.objects)
    const frames = sanitiseFrames(parsed.data.frames, objects)
    // Sanitisation must not have had to fix anything (drop/clamp = bad exemplar).
    expect(objects).toHaveLength(ex.example.objects.length)
    expect(frames).toHaveLength(ex.example.frames.length)
    objects.forEach((o, i) => {
      expect(o.x).toBe(ex.example.objects[i].x)
      expect(o.y).toBe(ex.example.objects[i].y)
    })
    // And the football validators must accept it against its own request.
    expect(validateAnimation(objects, frames, ex.request)).toEqual([])
  })

  it.each(EXEMPLARS.map((e) => [e.id, e] as const))('"%s" ball moves every frame', (_id, ex) => {
    // Exemplars teach ball-first choreography: the ball travels in every frame.
    for (const frame of ex.example.frames) {
      expect(frame.moves.some((m) => m.ref === 'ball')).toBe(true)
    }
  })
})

describe('exemplarFor keyword matching', () => {
  it('picks the pressing exemplar for pressing prompts', () => {
    expect(exemplarFor('high pressing trap on the left side').id).toBe('high-press')
    expect(exemplarFor('presión alta tras pérdida').id).toBe('high-press')
  })
  it('picks build-up for goalkeeper build-up prompts', () => {
    expect(exemplarFor('build-up from the goalkeeper against a 4-4-2').id).toBe('build-up')
    expect(exemplarFor('salida de balón desde el portero').id).toBe('build-up')
  })
  it('picks switch for diagonal switches', () => {
    expect(exemplarFor('switch of play with a long diagonal').id).toBe('switch-of-play')
  })
  it('picks overlap for wing overlaps and crosses', () => {
    expect(exemplarFor('full-back overlap and cross').id).toBe('overlap-cross')
  })
  it('picks rondo for rondos', () => {
    expect(exemplarFor('rondo 4v2 one-touch').id).toBe('rondo')
  })
  it('picks set pieces for corners and free kicks', () => {
    expect(exemplarFor('attacking corner with a near-post flick').id).toBe('corner-kick')
    expect(exemplarFor('free kick over the wall from the edge of the box').id).toBe('free-kick')
  })
  it('picks combinations for third man and one-two prompts', () => {
    expect(exemplarFor('third man combination through midfield').id).toBe('third-man-run')
    expect(exemplarFor('quick one-two around the defender').id).toBe('one-two')
  })
  it('picks defensive patterns', () => {
    expect(exemplarFor('compact low block shifting side to side').id).toBe('block-shift')
    expect(exemplarFor('counterpress immediately after losing possession').id).toBe('counterpress')
  })
  it('picks attacking patterns', () => {
    expect(exemplarFor('reach the byline and cut it back for the finish').id).toBe('cutback-finish')
    expect(exemplarFor('playing through pressure to escape the press').id).toBe('press-resistance')
  })
  it('falls back to the counter-attack default', () => {
    expect(exemplarFor('something entirely unrelated').id).toBe('counter-attack')
  })
})

describe('animationSystemPrompt grounding', () => {
  it('embeds the matched exemplar', () => {
    const sys = animationSystemPrompt('high pressing trap after losing the ball')
    expect(sys).toContain('High pressing trap on the touchline')
    expect(sys).not.toContain('Counter attack down the right')
  })
  it('defaults to counter-attack when nothing matches', () => {
    expect(animationSystemPrompt('')).toContain('Counter attack down the right')
  })
})
