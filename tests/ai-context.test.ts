// Coach context — who the session is for, and what that makes impossible.
//
// The gap this closes: the generator used to receive the coach's sentence and
// the board size, and nothing else. It could not distinguish an under-9 session
// from a senior one, so "4-3-3 high press" produced eleven players and a
// pressing scheme for a team that plays 7v7 and has never been taught to press.
// These tests pin the rules that make that impossible rather than merely
// unlikely.

import { describe, it, expect } from 'vitest'
import {
  AGE_PROFILES,
  DEFAULT_CONTEXT,
  FORMAT_PROFILES,
  conceptObjection,
  describeContext,
  isAgeGroup,
  isCoachLevel,
  isPlayFormat,
  maxPlayersPerTeam,
  resolveContext,
  type AgeGroup,
  type CoachContext,
} from '../src/modules/ai/ai.context.js'
import { validateAgeAppropriate, validateSquadSize } from '../src/modules/ai/ai.validate.js'
import type { CleanItem } from '../src/modules/ai/ai.schema.js'

const AGES = Object.keys(AGE_PROFILES) as AgeGroup[]

function squad(team: 'blue' | 'red', n: number): CleanItem[] {
  return Array.from({ length: n }, (_, i) => ({
    ref: `${team}${i}`,
    key: `player_${team}`,
    type: 'player',
    x: 100 + i * 40,
    y: 300,
    props: { label: String(i + 1) },
  })) as CleanItem[]
}

describe('the age rules are real football', () => {
  it('maps each age to the format it actually plays', () => {
    // English FA youth formats: 5v5 at U7/U8, 7v7 at U9/U10, 9v9 at U11/U12,
    // 11v11 from U13. Getting these wrong would make everything downstream wrong.
    expect(AGE_PROFILES.u7.format).toBe('5v5')
    expect(AGE_PROFILES.u9.format).toBe('7v7')
    expect(AGE_PROFILES.u11.format).toBe('9v9')
    expect(AGE_PROFILES.u13.format).toBe('11v11')
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
    expect(ctx.format).toBe('9v9') // follows the age
    expect(ctx.level).toBe('academy')
  })

  it('lets tonight override the profile', () => {
    // A coach who normally has an under-13 side but is covering seniors should
    // not have to edit their profile to get a sensible answer.
    const ctx = resolveContext({ age: 'senior' }, { age: 'u13', level: 'grassroots' })
    expect(ctx.age).toBe('senior')
    expect(ctx.format).toBe('11v11')
  })

  it('the format follows the age unless stated, so picking an age is one decision', () => {
    expect(resolveContext({ age: 'u9' }, undefined).format).toBe('7v7')
  })

  it('but a coach running an unusual format can still say so', () => {
    // 9v9 at under-9 happens; the age must not silently overrule the choice.
    expect(resolveContext({ age: 'u9', format: '9v9' }, undefined).format).toBe('9v9')
  })

  it("a request's age does not inherit the profile's stale format", () => {
    // Profile says senior/11v11; tonight is under-9. The format must follow the
    // NEW age, not carry 11v11 across from the profile.
    const ctx = resolveContext({ age: 'u9' }, { age: 'senior', format: '11v11' })
    expect(ctx.format).toBe('7v7')
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

describe('a squad that cannot exist is an error, not a low score', () => {
  const u9: CoachContext = { age: 'u9', format: '7v7', level: 'grassroots' }

  it('rejects eleven players in a 7v7 session', () => {
    const issues = validateSquadSize(squad('blue', 11), u9)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('7-a-side')
    expect(issues[0]).toContain('at most 7')
  })

  it('accepts a full 7v7 squad', () => {
    expect(validateSquadSize([...squad('blue', 7), ...squad('red', 7)], u9)).toHaveLength(0)
  })

  it('never objects to small-sided work — a 4v2 rondo is fine at any age', () => {
    expect(validateSquadSize([...squad('blue', 4), ...squad('red', 2)], u9)).toHaveLength(0)
  })

  it('checks both teams independently', () => {
    expect(validateSquadSize([...squad('blue', 11), ...squad('red', 11)], u9)).toHaveLength(2)
  })

  it('lets a senior side field eleven', () => {
    expect(validateSquadSize(squad('blue', 11), DEFAULT_CONTEXT)).toHaveLength(0)
  })

  it('the cap always matches the format', () => {
    expect(maxPlayersPerTeam({ ...DEFAULT_CONTEXT, format: '5v5' })).toBe(5)
    expect(maxPlayersPerTeam({ ...DEFAULT_CONTEXT, format: '7v7' })).toBe(7)
    expect(maxPlayersPerTeam({ ...DEFAULT_CONTEXT, format: '9v9' })).toBe(9)
    expect(maxPlayersPerTeam({ ...DEFAULT_CONTEXT, format: '11v11' })).toBe(11)
  })
})

describe('age-appropriate concepts', () => {
  const u9: CoachContext = { age: 'u9', format: '7v7', level: 'grassroots' }

  it('objects to a sustained press at under-9, and explains why', () => {
    const issues = validateAgeAppropriate('high_press', u9)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('Under 9')
    // The reason matters as much as the refusal — it goes to the coach.
    expect(issues[0].length).toBeGreaterThan(40)
  })

  it('is happy with the same concept for a senior side', () => {
    expect(validateAgeAppropriate('high_press', DEFAULT_CONTEXT)).toHaveLength(0)
  })

  it('allows what the age can actually do', () => {
    expect(validateAgeAppropriate('rondo', u9)).toHaveLength(0)
    expect(validateAgeAppropriate('one_two', u9)).toHaveLength(0)
  })

  it('says nothing when no concept was identified', () => {
    expect(validateAgeAppropriate(undefined, u9)).toHaveLength(0)
    expect(conceptObjection(u9, undefined)).toBeNull()
  })
})

describe('describing the context', () => {
  it('reads like something a coach would recognise', () => {
    expect(describeContext({ age: 'u9', format: '7v7', level: 'grassroots' }))
      .toBe('Under 9 · 7-a-side · Grassroots')
  })
})
