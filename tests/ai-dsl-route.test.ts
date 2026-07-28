// Dual-path animation route: DSL plan → compiler when the model picks a
// pattern; silent fallback to direct coordinate generation otherwise.

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

function grant() {
  dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
  dbMock.user.findUniqueOrThrow.mockResolvedValue({ bonusCredits: 0 } as never)
  dbMock.aiUsage.count.mockResolvedValue(0 as never)
  dbMock.aiUsage.create.mockResolvedValue({} as never)
  dbMock.$transaction.mockResolvedValue([] as never)
}

beforeEach(() => {
  gemini.configured = true
  gemini.generate.mockReset()
})

describe('POST /ai-animation dual path', () => {
  it('compiles a DSL plan — one model call, source "dsl"', async () => {
    const app = await getApp()
    grant()
    gemini.generate.mockResolvedValueOnce({
      fallback: false,
      pattern: 'overlap_wing',
      side: 'left',
      formation: '4-3-3',
      summary: 'El lateral dobla al extremo y centra al punto de penalti.',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-animation',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'desborde y centro por la izquierda' },
    })
    expect(res.statusCode).toBe(200)
    expect(gemini.generate).toHaveBeenCalledTimes(1)
    const body = res.json()
    expect(body.source).toBe('dsl')
    expect(body.summary).toMatch(/lateral/)
    expect(body.scene.objects.length).toBeGreaterThanOrEqual(4)
    expect(body.frames.length).toBeGreaterThanOrEqual(2)
    // Left side: the winger compiles onto the bottom flank.
    const lw = body.scene.objects.find((o: { ref: string }) => o.ref === 'h_lw')
    expect(lw.y).toBeGreaterThan(360)
  })

  it('falls back to direct generation when the plan says fallback', async () => {
    const app = await getApp()
    grant()
    const direct = {
      summary: 'Rondo layout',
      objects: [
        { ref: 'h1', key: 'player_blue', type: 'player', x: 300, y: 300, props: { label: '8' } },
        { ref: 'ball', key: 'white_ball', type: 'football', x: 310, y: 305 },
      ],
      frames: [{ moves: [{ ref: 'h1', to: { x: 400, y: 340 } }, { ref: 'ball', to: { x: 405, y: 345 } }] }],
    }
    gemini.generate
      .mockResolvedValueOnce({ fallback: true, summary: 'n/a' })
      .mockResolvedValueOnce(direct)

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-animation',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'a custom shape drill for my team' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().source).toBe('gemini')
    expect(gemini.generate).toHaveBeenCalledTimes(2)
  })

  it('falls back when the plan call itself throws', async () => {
    const app = await getApp()
    grant()
    const direct = {
      summary: 'ok',
      objects: [
        { ref: 'h1', key: 'player_blue', type: 'player', x: 300, y: 300, props: { label: '8' } },
        { ref: 'ball', key: 'white_ball', type: 'football', x: 310, y: 305 },
      ],
      frames: [{ moves: [{ ref: 'h1', to: { x: 400, y: 340 } }, { ref: 'ball', to: { x: 405, y: 345 } }] }],
    }
    gemini.generate
      .mockRejectedValueOnce(new Error('plan timeout'))
      .mockResolvedValueOnce(direct)

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-animation',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'anything' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().source).toBe('gemini')
  })

  it('an invalid pattern id degrades to fallback, never 500s', async () => {
    const app = await getApp()
    grant()
    const direct = {
      summary: 'ok',
      objects: [
        { ref: 'h1', key: 'player_blue', type: 'player', x: 300, y: 300, props: { label: '8' } },
        { ref: 'ball', key: 'white_ball', type: 'football', x: 310, y: 305 },
      ],
      frames: [{ moves: [{ ref: 'h1', to: { x: 400, y: 340 } }, { ref: 'ball', to: { x: 405, y: 345 } }] }],
    }
    gemini.generate
      .mockResolvedValueOnce({ fallback: false, pattern: 'not_a_real_pattern', summary: 'x' })
      .mockResolvedValueOnce(direct)

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-animation',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'whatever' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().source).toBe('gemini')
  })
})
