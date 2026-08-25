// Coach context end to end: does knowing the age actually change the output?
//
// The rules themselves are unit-tested in ai-context.test.ts. What matters here
// is that the context reaches the model — a perfectly correct rules table that
// never makes it into the prompt changes nothing.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'

const gemini = vi.hoisted(() => ({
  configured: true,
  generate: vi.fn<(system: string, user: string, options?: unknown) => Promise<unknown>>(),
}))

vi.mock('../src/config/gemini.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/config/gemini.js')>()
  return {
    GeminiError: original.GeminiError,
    geminiConfigured: () => gemini.configured,
    generateTacticsJson: gemini.generate,
  }
})

/** A small, valid 7v7-sized layout so nothing else trips a validator. */
const validLayout = {
  summary: 'setup',
  objects: [
    { ref: 'h9', key: 'player_blue', type: 'player', x: 800, y: 360, props: { label: '9' } },
    { ref: 'h7', key: 'player_blue', type: 'player', x: 600, y: 200, props: { label: '7' } },
  ],
}

/** `profile` is what the users row returns for the coach-context columns. */
function grant(profile: Record<string, string | null> | null = null) {
  dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
  dbMock.user.findUniqueOrThrow.mockResolvedValue({ bonusCredits: 0 } as never)
  dbMock.user.findUnique.mockResolvedValue(profile as never)
  dbMock.aiUsage.count.mockResolvedValue(0 as never)
  dbMock.aiUsage.create.mockResolvedValue({} as never)
  dbMock.aiUsage.findFirst.mockResolvedValue(null as never)
  dbMock.$transaction.mockResolvedValue([] as never)
}

/** The system prompt of the first model call. */
function systemPrompt(): string {
  return String(gemini.generate.mock.calls[0][0])
}

beforeEach(() => {
  gemini.configured = true
  gemini.generate.mockReset()
  gemini.generate.mockResolvedValue(validLayout)
})

describe('the model is told who the session is for', () => {
  it('uses the saved profile', async () => {
    const app = await getApp()
    grant({ coachAgeGroup: 'u9', coachFormat: null, coachLevel: 'grassroots' })
    await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'passing drill' },
    })
    const system = systemPrompt()
    expect(system).toContain('Under 9')
    expect(system).toContain('7-a-side')
    // The hard limit must be stated as a number, not implied.
    expect(system).toContain('at most 7 players per team')
  })

  it('tells it what is NOT appropriate, with the reason', async () => {
    const app = await getApp()
    grant({ coachAgeGroup: 'u9', coachFormat: null, coachLevel: null })
    await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'high press' },
    })
    const system = systemPrompt()
    expect(system).toContain('NOT appropriate for this age group')
    expect(system).toContain('high_press')
    // And asks for a substitute rather than a refusal — a coach with no drill
    // is worse off than a coach with the right drill for their age.
    expect(system).toContain('age-appropriate alternative')
  })

  it('lets the request override the profile for tonight', async () => {
    const app = await getApp()
    grant({ coachAgeGroup: 'u9', coachFormat: null, coachLevel: null })
    await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'build up', context: { age: 'senior' } },
    })
    const system = systemPrompt()
    expect(system).toContain('Senior')
    expect(system).toContain('at most 11 players per team')
    expect(system).not.toContain('Under 9')
  })

  it('falls back to senior when the coach has set nothing', async () => {
    const app = await getApp()
    grant(null)
    await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'counter attack' },
    })
    expect(systemPrompt()).toContain('Senior · 11-a-side')
  })

  it('still generates when the profile lookup fails', async () => {
    // Context improves the answer; it is not permission to produce one. A
    // database hiccup — or a Prisma client that predates the migration — must
    // not cost a coach a generation. Only the coach-context read fails here;
    // the entitlement guard reads the same table for `role` and must still work.
    const app = await getApp()
    grant(null)
    dbMock.user.findUnique.mockImplementation((async (args: { select?: Record<string, unknown> }) => {
      if (args?.select && 'coachAgeGroup' in args.select) {
        throw new Error('Unknown field `coachAgeGroup`')
      }
      return { role: 'user' }
    }) as never)
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'counter attack' },
    })
    expect(res.statusCode).toBe(200)
    expect(systemPrompt()).toContain('Senior')
  })

  it('ignores an unknown age instead of rejecting the request', async () => {
    const app = await getApp()
    grant(null)
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'rondo', context: { age: 'u4' } },
    })
    expect(res.statusCode).toBe(200)
    expect(systemPrompt()).toContain('Senior')
  })
})

describe('formation, squad and the stated problem reach the model', () => {
  it('teaches the model which formations exist in this format', async () => {
    const app = await getApp()
    grant({ coachAgeGroup: 'u9', coachFormat: null, coachLevel: null })
    await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'team shape work' },
    })
    const system = systemPrompt()
    expect(system).toContain('2-3-1')
    expect(system).toContain('never lined up in a 4-3-3')
  })

  it('carries the saved formation and squad size', async () => {
    const app = await getApp()
    grant({
      coachAgeGroup: 'u9', coachFormat: null, coachLevel: null,
      coachFormation: '2-3-1', coachSquadSize: 14,
    } as never)
    await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'passing session' },
    })
    const system = systemPrompt()
    expect(system).toContain('This team plays a 2-3-1')
    expect(system).toContain('14 players available')
  })

  it('drops a saved formation that does not exist in the overridden format', async () => {
    // Profile: senior 4-3-3. Override: under-9 tonight. The prompt must not
    // describe a 4-3-3 to a 7v7 session.
    const app = await getApp()
    grant({
      coachAgeGroup: 'senior', coachFormat: '11v11', coachLevel: null,
      coachFormation: '4-3-3', coachSquadSize: null,
    } as never)
    await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'shape work', context: { age: 'u9' } },
    })
    expect(systemPrompt()).not.toContain('This team plays a 4-3-3')
  })

  it("puts the coach's problem at the heart of the prompt", async () => {
    const app = await getApp()
    grant(null)
    await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: {
        prompt: 'passing drill',
        context: { problem: 'we lose the ball under pressure' },
      },
    })
    const system = systemPrompt()
    expect(system).toContain("THE COACH'S SPECIFIC PROBLEM")
    expect(system).toContain('we lose the ball under pressure')
    // And it is wired into the machinery: the model must claim it in the brief,
    // where the self-consistency validators can hold it to account.
    expect(system).toContain('Set brief.problem to it')
  })
})

describe('the compiler is held to the same football standard', () => {
  it('refuses a pressing pattern for an under-9 side', async () => {
    // The compiler's geometry is perfect and its football is wrong here: an
    // under-9 team does not press as a unit. Falling through hands the request
    // to the generation path, which HAS been told the age and is asked for the
    // closest age-appropriate alternative — better than shipping it, and much
    // better than refusing.
    const app = await getApp()
    grant({ coachAgeGroup: 'u9', coachFormat: null, coachLevel: null })
    gemini.generate.mockReset()
    // Call 1: the planner picks a pattern. Call 2: the fallback generation.
    gemini.generate.mockResolvedValueOnce({
      fallback: false,
      pattern: 'high_press_trap',
      side: 'left',
      formation: '4-3-3',
      summary: 'press',
    })
    gemini.generate.mockResolvedValue({
      summary: 'age-appropriate version',
      objects: validLayout.objects,
      frames: [{ moves: [{ ref: 'h9', to: { x: 900, y: 360 } }] }],
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-animation',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'high press trap' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().source).not.toBe('dsl')
  })

  it('compiles the same pattern happily for a senior side', async () => {
    const app = await getApp()
    grant(null)
    gemini.generate.mockReset()
    gemini.generate.mockResolvedValueOnce({
      fallback: false,
      pattern: 'high_press_trap',
      side: 'left',
      formation: '4-3-3',
      summary: 'press',
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-animation',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'high press trap' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().source).toBe('dsl')
  })

  it('a small-sided pattern is fine at any age — the squad check is not a blunt instrument', async () => {
    // overlap_wing compiles to 3v3, which fits inside every format we support.
    const app = await getApp()
    grant({ coachAgeGroup: 'u9', coachFormat: null, coachLevel: null })
    gemini.generate.mockReset()
    gemini.generate.mockResolvedValueOnce({
      fallback: false,
      pattern: 'overlap_wing',
      side: 'left',
      formation: '4-3-3',
      summary: 'overlap',
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-animation',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'overlap down the left wing' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().source).toBe('dsl')
  })
})
