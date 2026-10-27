// Coach context — who the session is for, and what that makes impossible.
//
// Kept when the old AI module was removed (27 Oct 2026): the coach profile
// validates against these tables and the new assistant will read them.
// The gap this closes: a generator that receives only the coach's sentence and
// the board size. It could not distinguish an under-9 session
// from a senior one, so "4-3-3 high press" produced eleven players and a
// pressing scheme for a team that plays 7v7 and has never been taught to press.
// These tests pin the rules that make that impossible rather than merely
// unlikely.

import { describe, it, expect } from 'vitest'
import {
  AGE_PROFILES,
  DEFAULT_CONTEXT,
  FORMAT_PROFILES,
  FORMATIONS_BY_FORMAT,
  conceptObjection,
  describeContext,
  isAgeGroup,
  isCoachLevel,
  isPlayFormat,
  maxPlayersPerTeam,
  resolveContext,
  type AgeGroup,
  type CoachContext,
} from '../src/lib/coachContext.js'

const AGES = Object.keys(AGE_PROFILES) as AgeGroup[]

describe('the age rules are real football', () => {
  it('FR-I9 · suggests England\'s 2026/27 (FutureFit) format for each age — a suggestion only', () => {
    // 3v3 U7 (drawn on our smallest pitch, 5v5), 5v5 U8–U9, 7v7 U10–U11,
    // 9v9 U12–U13, 11v11 from U14. The coach's own format always wins.
    expect(AGE_PROFILES.u7.format).toBe('5v5')
    expect(AGE_PROFILES.u9.format).toBe('5v5')
    expect(AGE_PROFILES.u11.format).toBe('7v7')
    expect(AGE_PROFILES.u13.format).toBe('9v9')
    expect(AGE_PROFILES.u15.format).toBe('11v11')
    expect(AGE_PROFILES.senior.format).toBe('11v11')
  })

  it('never lets a younger group run faster than an older one', () => {
    for (let i = 1; i < AGES.length; i++) {
      const younger = AGE_PROFILES[AGES[i - 1]]
      const older = AGE_PROFILES[AGES[i]]
      expect(older.runSpeed, `${AGES[i]} vs ${AGES[i - 1]}`).toBeGreaterThanOrEqual(younger.runSpeed)
      expect(older.maxPhases).toBeGreaterThanOrEqual(younger.maxPhases)
    }
  })

  it('keeps every speed inside human range', () => {
    for (const age of AGES) {
      expect(AGE_PROFILES[age].runSpeed).toBeGreaterThan(2)
      expect(AGE_PROFILES[age].runSpeed).toBeLessThanOrEqual(9)
    }
  })

  it('every age profile points at a format that exists', () => {
    for (const age of AGES) {
      expect(FORMAT_PROFILES[AGE_PROFILES[age].format]).toBeDefined()
    }
  })

  it('gives a reason with every restriction, never a bare refusal', () => {
    for (const age of AGES) {
      for (const [concept, why] of Object.entries(AGE_PROFILES[age].disallowedConcepts)) {
        expect(concept.length, age).toBeGreaterThan(0)
        expect(why.length, `${age}/${concept}`).toBeGreaterThan(15)
      }
    }
  })

  it('restricts the young and frees the old', () => {
    expect(Object.keys(AGE_PROFILES.u7.disallowedConcepts).length).toBeGreaterThan(0)
    expect(Object.keys(AGE_PROFILES.senior.disallowedConcepts)).toHaveLength(0)
    expect(Object.keys(AGE_PROFILES.u17.disallowedConcepts)).toHaveLength(0)
  })
})

describe('choosing the context for a generation', () => {
  it('defaults to senior 11-a-side when nobody has said anything', () => {
    expect(resolveContext(undefined, undefined)).toEqual(DEFAULT_CONTEXT)
  })

  it('uses the saved profile when the request says nothing', () => {
    const ctx = resolveContext(undefined, { age: 'u11', level: 'academy' })
    expect(ctx.age).toBe('u11')
    expect(ctx.format).toBe('7v7') // suggested by the age…
    expect(ctx.formatSource).toBe('age') // …and marked as assumed
    expect(ctx.level).toBe('academy')
  })

  it("FR-I9 · the coach's saved format beats the age's suggestion", () => {
    const ctx = resolveContext(undefined, { age: 'u11', format: '9v9' })
    expect(ctx.format).toBe('9v9')
    expect(ctx.formatSource).toBe('coach')
    // Same age tonight: the saved format still applies.
    expect(resolveContext({ age: 'u11' }, { age: 'u11', format: '9v9' }).format).toBe('9v9')
  })

  it('FR-I9 · the summary says when the format was assumed', () => {
    expect(describeContext(resolveContext({ age: 'u9' }, undefined))).toContain('assumed from age')
    expect(describeContext(resolveContext({ age: 'u9', format: '7v7' }, undefined))).not.toContain('assumed')
  })

  it('lets tonight override the profile', () => {
    // A coach who normally has an under-13 side but is covering seniors should
    // not have to edit their profile to get a sensible answer.
    const ctx = resolveContext({ age: 'senior' }, { age: 'u13', level: 'grassroots' })
    expect(ctx.age).toBe('senior')
    expect(ctx.format).toBe('11v11')
  })

  it('with no format stated, the age suggests one', () => {
    expect(resolveContext({ age: 'u9' }, undefined).format).toBe('5v5')
  })

  it('but a coach running an unusual format can still say so', () => {
    // 9v9 at under-9 happens; the age must not silently overrule the choice.
    expect(resolveContext({ age: 'u9', format: '9v9' }, undefined).format).toBe('9v9')
  })

  it("a request's age does not inherit the profile's stale format", () => {
    // Profile says senior/11v11; tonight is under-9. The format must follow the
    // NEW age, not carry 11v11 across from the profile.
    const ctx = resolveContext({ age: 'u9' }, { age: 'senior', format: '11v11' })
    expect(ctx.format).toBe('5v5')
    expect(ctx.formatSource).toBe('age')
  })

  it('ignores rubbish instead of failing the generation', () => {
    const ctx = resolveContext(
      { age: 'u4', format: '15v15', level: 'olympian' },
      { age: 'nonsense' },
    )
    expect(ctx).toEqual(DEFAULT_CONTEXT)
  })

  it('accepts nulls from the database as "not set"', () => {
    expect(resolveContext(undefined, { age: null, format: null, level: null })).toEqual(DEFAULT_CONTEXT)
  })
})

describe('the type guards', () => {
  it('accept only shipped values', () => {
    expect(isAgeGroup('u9')).toBe(true)
    expect(isAgeGroup('u10')).toBe(false)
    expect(isPlayFormat('7v7')).toBe(true)
    expect(isPlayFormat('6v6')).toBe(false)
    expect(isCoachLevel('academy')).toBe(true)
    expect(isCoachLevel('pro')).toBe(false)
    expect(isAgeGroup(undefined)).toBe(false)
    expect(isAgeGroup(9)).toBe(false)
  })
})

describe('the format sets the squad size', () => {
  it('the cap always matches the format', () => {
    expect(maxPlayersPerTeam({ ...DEFAULT_CONTEXT, format: '5v5' })).toBe(5)
    expect(maxPlayersPerTeam({ ...DEFAULT_CONTEXT, format: '7v7' })).toBe(7)
    expect(maxPlayersPerTeam({ ...DEFAULT_CONTEXT, format: '8v8' })).toBe(8)
    expect(maxPlayersPerTeam({ ...DEFAULT_CONTEXT, format: '9v9' })).toBe(9)
    expect(maxPlayersPerTeam({ ...DEFAULT_CONTEXT, format: '11v11' })).toBe(11)
  })

  it('a concept the age is not ready for comes with a reason', () => {
    const u9: CoachContext = { age: 'u9', format: '7v7', level: 'grassroots' }
    expect(conceptObjection(u9, 'high_press')?.length ?? 0).toBeGreaterThan(40)
    expect(conceptObjection(DEFAULT_CONTEXT, 'high_press')).toBeNull()
    expect(conceptObjection(u9, undefined)).toBeNull()
  })
})

describe('formations belong to a format', () => {
  it('every format lists real shapes that sum to its outfield count', () => {
    for (const [format, formations] of Object.entries(FORMATIONS_BY_FORMAT)) {
      const outfield = FORMAT_PROFILES[format as keyof typeof FORMAT_PROFILES].perTeam - 1
      for (const f of formations) {
        const sum = f.split('-').reduce((a, b) => a + Number(b), 0)
        expect(sum, `${format} ${f}`).toBe(outfield)
      }
    }
  })

  it('keeps a formation that fits the resolved format', () => {
    const ctx = resolveContext({ age: 'u9', format: '7v7', formation: '2-3-1' }, undefined)
    expect(ctx.formation).toBe('2-3-1')
  })

  it('drops a profile formation that does not exist in tonight\'s format', () => {
    // Profile: senior 4-3-3. Tonight: under-9 (5v5 suggested). A small-sided
    // team has never lined up in a 4-3-3, so no formation beats a wrong one.
    const ctx = resolveContext({ age: 'u9' }, { age: 'senior', formation: '4-3-3' })
    expect(ctx.format).toBe('5v5')
    expect(ctx.formation).toBeUndefined()
  })

  it('drops invented formations entirely', () => {
    expect(resolveContext({ age: 'senior', formation: '9-0-1' }, undefined).formation).toBeUndefined()
  })
})

describe('squad size and the stated problem', () => {
  it('carries a sensible squad number through', () => {
    expect(resolveContext({ age: 'u9', squad: 14 }, undefined).squad).toBe(14)
  })

  it('drops nonsense squad values instead of failing', () => {
    expect(resolveContext({ squad: 0 }, undefined).squad).toBeUndefined()
    expect(resolveContext({ squad: 999 }, undefined).squad).toBeUndefined()
    expect(resolveContext({ squad: 'many' }, undefined).squad).toBeUndefined()
  })

  it('trims and caps the problem text before it nears a prompt', () => {
    const ctx = resolveContext({ problem: '  we lose the ball under pressure  ' }, undefined)
    expect(ctx.problem).toBe('we lose the ball under pressure')
    expect(resolveContext({ problem: 'x'.repeat(500) }, undefined).problem).toHaveLength(160)
    expect(resolveContext({ problem: '  ' }, undefined).problem).toBeUndefined()
  })
})

describe('describing the context', () => {
  it('reads like something a coach would recognise', () => {
    expect(describeContext({ age: 'u9', format: '7v7', level: 'grassroots' }))
      .toBe('Under 9 · 7-a-side · Grassroots')
  })
})
