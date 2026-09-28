// Unrated sessions count at their type's typical intensity — marked as estimates.

import { describe, it, expect } from 'vitest'
import { effectiveRpe, TYPICAL_RPE, sessionLoad } from '../src/lib/planner.js'

describe('effectiveRpe', () => {
  it("the coach's own rating always wins", () => {
    expect(effectiveRpe(9, 'recovery')).toEqual({ rpe: 9, estimated: false })
  })
  it('an unrated session uses the typical intensity for its type, flagged as an estimate', () => {
    expect(effectiveRpe(null, 'tactical')).toEqual({ rpe: TYPICAL_RPE.tactical, estimated: true })
    expect(effectiveRpe(0, 'physical')).toEqual({ rpe: 7, estimated: true })
  })
  it('a match is a match, whatever type was picked', () => {
    expect(effectiveRpe(null, 'tactical', true).rpe).toBe(8)
  })
  it('rest carries no load and is not an estimate', () => {
    expect(effectiveRpe(null, 'rest')).toEqual({ rpe: 0, estimated: false })
  })
  it('90 minutes of unrated tactical training is no longer 0 load', () => {
    expect(sessionLoad({ minutes: 90, rpe: effectiveRpe(null, 'tactical').rpe })).toBe(450)
  })
})
