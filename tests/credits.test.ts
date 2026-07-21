// AI credits — plan allowances, the 402 gate, bonus-credit fallback and the
// reel-copy endpoint (all with a mocked Gemini client).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'

const gemini = vi.hoisted(() => ({
  configured: true,
  generate: vi.fn<(system: string, user: string) => Promise<unknown>>(),
}))

vi.mock('../src/config/gemini.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/config/gemini.js')>()
  return {
    GeminiError: original.GeminiError,
    geminiConfigured: () => gemini.configured,
    generateTacticsJson: gemini.generate,
  }
})

const validReelCopy = {
  title: 'High Press Buildup Phase',
  subtitle: 'Pressing trigger analysis',
  quote: 'Press high, win the ball in their half',
  quoteDetail: 'Force errors by cutting off the pivot early.',
  stats: [
    { value: '87%', label: 'Press rate' },
    { value: '6s', label: 'Trigger time' },
    { value: '3v2', label: 'Overload' },
  ],
  tags: ['4-3-3', 'HIGH PRESS', 'BUILDUP'],
  hashtags: '#football #coaching #tactics',
}

function baseMocks({ status = 'active', slug = 'pro-ai', used = 0, bonus = 0 } = {}) {
  dbMock.userSubscription.findUnique.mockResolvedValue(
    activeSubscription({ status, plan: { id: 2, name: 'Plan', slug } }) as never,
  )
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
  dbMock.user.findUniqueOrThrow.mockResolvedValue({ bonusCredits: bonus } as never)
  dbMock.aiUsage.count.mockResolvedValue(used as never)
  dbMock.aiUsage.create.mockResolvedValue({} as never)
  dbMock.user.update.mockResolvedValue({} as never)
  dbMock.$transaction.mockResolvedValue([] as never)
}

beforeEach(() => {
  gemini.configured = true
  gemini.generate.mockReset()
})

describe('GET /api/canvas/ai-credits', () => {
  it('reports the pro-ai monthly allowance', async () => {
    const app = await getApp()
    baseMocks({ used: 2 })
    const res = await app.inject({
      method: 'GET',
      url: '/api/canvas/ai-credits',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ allowance: 5, used: 2, bonus: 0, remaining: 3, monthly: true })
  })

  it('trial gets a one-off total of 3', async () => {
    const app = await getApp()
    baseMocks({ status: 'trial', used: 1 })
    const res = await app.inject({
      method: 'GET',
      url: '/api/canvas/ai-credits',
      headers: authHeaders(await accessToken()),
    })
    expect(res.json()).toMatchObject({ allowance: 3, remaining: 2, monthly: false })
  })
})

describe('credit gate on generation', () => {
  it('blocks with 402 when the trial credits are spent — Gemini never called', async () => {
    const app = await getApp()
    baseMocks({ status: 'trial', used: 3 })
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: '4-3-3 press' },
    })
    expect(res.statusCode).toBe(402)
    expect(res.json().message).toMatch(/trial AI credits/i)
    expect(gemini.generate).not.toHaveBeenCalled()
  })

  it('falls back to bonus credits when the month is exhausted', async () => {
    const app = await getApp()
    baseMocks({ used: 5, bonus: 2 }) // monthly allowance gone, top-ups remain
    gemini.generate.mockResolvedValue(validReelCopy)
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/reel-copy',
      headers: authHeaders(await accessToken()),
      payload: { boardTitle: 'High press', objectCount: 12, frameCount: 3 },
    })
    expect(res.statusCode).toBe(200)
    // Spend records usage AND decrements a bonus credit.
    expect(dbMock.aiUsage.create).toHaveBeenCalledWith({ data: { userId: 1, kind: 'reel' } })
    expect(dbMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { bonusCredits: { decrement: 1 } } }),
    )
  })
})

describe('POST /api/canvas/reel-copy', () => {
  it('returns validated copy and the new balance', async () => {
    const app = await getApp()
    baseMocks({ used: 1 })
    gemini.generate.mockResolvedValue(validReelCopy)
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/reel-copy',
      headers: authHeaders(await accessToken()),
      payload: { boardTitle: 'High Press Buildup', prompt: 'focus on the pivot', objectCount: 22, frameCount: 4 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.copy.title).toBe('High Press Buildup Phase')
    expect(body.copy.stats).toHaveLength(3)
    expect(body.creditsRemaining).toBe(3) // 5 - 1 used - this spend
  })

  it('502s (without spending) when the model returns junk', async () => {
    const app = await getApp()
    baseMocks()
    gemini.generate.mockResolvedValue({ nonsense: true })
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/reel-copy',
      headers: authHeaders(await accessToken()),
      payload: { boardTitle: 'x' },
    })
    expect(res.statusCode).toBe(502)
    expect(dbMock.aiUsage.create).not.toHaveBeenCalled()
  })
})
