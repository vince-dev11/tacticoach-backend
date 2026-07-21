// AI tactical generator — /api/canvas/ai-layout and /ai-animation with a
// mocked Gemini client.

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

function grantEditorAccess() {
  dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
  // Credit gate: fresh month, no bonus credits → 5/5 pro-ai allowance free.
  dbMock.user.findUniqueOrThrow.mockResolvedValue({ bonusCredits: 0 } as never)
  dbMock.aiUsage.count.mockResolvedValue(0 as never)
  dbMock.aiUsage.create.mockResolvedValue({} as never)
  dbMock.$transaction.mockResolvedValue([] as never)
}

function revokeEditorAccess() {
  dbMock.userSubscription.findUnique.mockResolvedValue(null)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
}

const validLayout = {
  summary: 'A high-pressing 4-3-3 with aggressive full-backs.',
  objects: [
    { ref: 'h1', key: 'player_blue', type: 'player', x: 80, y: 360, props: { label: '1' } },
    { ref: 'h9', key: 'player_blue', type: 'player', x: 900, y: 360, props: { label: '9' } },
    { ref: 'ball', key: 'white_ball', type: 'football', x: 700, y: 360 },
  ],
}

const validAnimation = {
  ...validLayout,
  frames: [
    { moves: [{ ref: 'h9', to: { x: 1100, y: 300 } }] },
    { moves: [{ ref: 'h9', to: { x: 1250, y: 360 } }, { ref: 'ball', to: { x: 1260, y: 360 } }] },
  ],
}

beforeEach(() => {
  gemini.configured = true
  gemini.generate.mockReset()
})

describe('POST /api/canvas/ai-layout', () => {
  it('requires auth', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/canvas/ai-layout', payload: { prompt: '4-3-3 press' } })
    expect(res.statusCode).toBe(401)
  })

  it('requires editor entitlement (403 for expired trials)', async () => {
    const app = await getApp()
    revokeEditorAccess()
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: '4-3-3 press' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('NO_EDITOR_ACCESS')
    expect(gemini.generate).not.toHaveBeenCalled()
  })

  it('returns 503 when Gemini is not configured', async () => {
    const app = await getApp()
    grantEditorAccess()
    gemini.configured = false
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: '4-3-3 press' },
    })
    expect(res.statusCode).toBe(503)
  })

  it('returns the layout in the editor wire format', async () => {
    const app = await getApp()
    grantEditorAccess()
    gemini.generate.mockResolvedValue(validLayout)

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'Create a high pressing 4-3-3', generation_mode: 'auto' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.source).toBe('gemini')
    expect(body.summary).toContain('4-3-3')
    expect(body.layout).toHaveLength(3)
    expect(body.layout[0]).toMatchObject({ ref: 'h1', key: 'player_blue', type: 'player' })
    // Coach's tactical instructions reach the model
    const [system, user] = gemini.generate.mock.calls[0]
    expect(system).toContain('player_blue')
    expect(user).toContain('high pressing 4-3-3')
  })

  it('clamps out-of-board coordinates and drops unknown types', async () => {
    const app = await getApp()
    grantEditorAccess()
    gemini.generate.mockResolvedValue({
      summary: 'ok',
      objects: [
        { ref: 'h1', key: 'player_blue', type: 'player', x: -100, y: 9999 },
        { ref: 'x1', key: 'weird', type: 'spaceship', x: 100, y: 100 },
      ],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'test prompt' },
    })
    expect(res.statusCode).toBe(200)
    const { layout } = res.json()
    expect(layout).toHaveLength(1)
    expect(layout[0]).toMatchObject({ x: 40, y: 680 })
  })

  it('retries once on a malformed response, then succeeds', async () => {
    const app = await getApp()
    grantEditorAccess()
    const { GeminiError } = await import('../src/config/gemini.js')
    gemini.generate
      .mockRejectedValueOnce(new GeminiError('Gemini returned invalid JSON'))
      .mockResolvedValueOnce(validLayout)

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'test prompt' },
    })
    expect(res.statusCode).toBe(200)
    expect(gemini.generate).toHaveBeenCalledTimes(2)
  })

  it('returns 502 when Gemini keeps failing', async () => {
    const app = await getApp()
    grantEditorAccess()
    const { GeminiError } = await import('../src/config/gemini.js')
    gemini.generate.mockRejectedValue(new GeminiError('Gemini responded 500'))

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'test prompt' },
    })
    expect(res.statusCode).toBe(502)
  })

  it('rejects empty prompts with 422', async () => {
    const app = await getApp()
    grantEditorAccess()
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'ab' },
    })
    expect(res.statusCode).toBe(422)
    expect(gemini.generate).not.toHaveBeenCalled()
  })
})

describe('POST /api/canvas/ai-animation', () => {
  it('returns scene + frames in the editor wire format', async () => {
    const app = await getApp()
    grantEditorAccess()
    gemini.generate.mockResolvedValue(validAnimation)

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-animation',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'Counter attack from a turnover, 3 frames' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.scene.objects).toHaveLength(3)
    expect(body.frames).toHaveLength(2)
    expect(body.frames[0].moves[0]).toEqual({ ref: 'h9', to: { x: 1100, y: 300 } })
  })

  it('filters moves that reference unknown objects', async () => {
    const app = await getApp()
    grantEditorAccess()
    gemini.generate.mockResolvedValue({
      ...validLayout,
      frames: [
        { moves: [{ ref: 'h9', to: { x: 1000, y: 300 } }, { ref: 'ghost', to: { x: 1, y: 1 } }] },
        { moves: [{ ref: 'ghost2', to: { x: 5, y: 5 } }] }, // becomes empty → dropped
      ],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-animation',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'test animation' },
    })
    expect(res.statusCode).toBe(200)
    const { frames } = res.json()
    expect(frames).toHaveLength(1)
    expect(frames[0].moves).toHaveLength(1)
    expect(frames[0].moves[0].ref).toBe('h9')
  })

  it('502s when the animation has no usable frames at all', async () => {
    const app = await getApp()
    grantEditorAccess()
    gemini.generate.mockResolvedValue({
      ...validLayout,
      frames: [{ moves: [{ ref: 'ghost', to: { x: 1, y: 1 } }] }],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-animation',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'test animation' },
    })
    expect(res.statusCode).toBe(502)
  })
})
