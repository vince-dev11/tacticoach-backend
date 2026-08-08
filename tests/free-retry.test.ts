// Free retry: re-running the SAME prompt shortly after a generation is on us.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'
import { promptFingerprint, FREE_RETRY_WINDOW_MS } from '../src/lib/credits.js'

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

const validLayout = {
  summary: 'setup',
  objects: [
    { ref: 'h9', key: 'player_blue', type: 'player', x: 800, y: 360, props: { label: '9' } },
    { ref: 'h7', key: 'player_blue', type: 'player', x: 600, y: 200, props: { label: '7' } },
  ],
}

/** `previous` = the aiUsage row findFirst should return (null = no earlier run). */
function grant(previous: { freeRetry: boolean } | null = null) {
  dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
  dbMock.user.findUniqueOrThrow.mockResolvedValue({ bonusCredits: 0 } as never)
  dbMock.aiUsage.count.mockResolvedValue(3 as never)
  dbMock.aiUsage.create.mockResolvedValue({} as never)
  dbMock.aiUsage.findFirst.mockResolvedValue(previous as never)
  dbMock.$transaction.mockResolvedValue([] as never)
}

beforeEach(() => {
  gemini.configured = true
  gemini.generate.mockReset()
  gemini.generate.mockResolvedValue(validLayout)
})

describe('prompt fingerprint', () => {
  it('ignores case and whitespace noise', () => {
    expect(promptFingerprint('Counter Attack')).toBe(promptFingerprint('  counter   attack '))
  })
  it('differs for different ideas', () => {
    expect(promptFingerprint('counter attack')).not.toBe(promptFingerprint('high press'))
  })
  it('never contains the prompt itself', () => {
    expect(promptFingerprint('secret tactic name')).not.toMatch(/secret|tactic/)
  })
  it('window is 15 minutes', () => {
    expect(FREE_RETRY_WINDOW_MS).toBe(15 * 60 * 1000)
  })
})

describe('POST /ai-layout free retry', () => {
  it('charges a credit for a first generation', async () => {
    const app = await getApp()
    grant(null) // nothing generated before
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'counter attack down the right' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().freeRetry).toBe(false)
    // A paid generation stores the fingerprint so a retry can be matched to it.
    expect(dbMock.aiUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'layout', promptHash: expect.any(String) }),
      }),
    )
  })

  it('is FREE when the same prompt was just generated', async () => {
    const app = await getApp()
    grant({ freeRetry: false }) // a paid run of this same prompt exists
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'counter attack down the right' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().freeRetry).toBe(true)
    // Recorded for telemetry, but flagged so it never consumes the allowance.
    expect(dbMock.aiUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ freeRetry: true }) }),
    )
    // No bonus credit decrement on a free run.
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it('does not give two free retries in a row', async () => {
    const app = await getApp()
    grant({ freeRetry: true }) // the previous run was itself the free one
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'counter attack down the right' },
    })
    expect(res.json().freeRetry).toBe(false)
  })

  it('looks only at the same prompt inside the window', async () => {
    const app = await getApp()
    grant(null)
    await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'high press trap' },
    })
    const where = dbMock.aiUsage.findFirst.mock.calls[0][0].where
    expect(where.promptHash).toBe(promptFingerprint('high press trap'))
    expect(where.kind).toBe('layout')
    expect(where.createdAt.gte).toBeInstanceOf(Date)
    expect(Date.now() - where.createdAt.gte.getTime()).toBeLessThanOrEqual(FREE_RETRY_WINDOW_MS + 5000)
  })
})

describe('billing never destroys a generation', () => {
  // A real incident: a stale Prisma client made the credit lookup throw AFTER a
  // good animation had been produced. The coach waited twelve seconds, the model
  // did its job, and the request returned 500 — no result, and no charge either.
  // The gate before generation fails CLOSED (don't spend money on an unverified
  // account); the bookkeeping after it fails OPEN.
  it('returns the work when the credit lookup blows up', async () => {
    const app = await getApp()
    grant(null)
    dbMock.aiUsage.findFirst.mockRejectedValue(
      new Error('Unknown argument `promptHash`') as never,
    )
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'counter attack down the right' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().layout).toHaveLength(2)
    // The balance is unknown rather than wrongly reported as zero.
    expect(res.json().creditsRemaining).toBeNull()
    expect(res.json().freeRetry).toBe(false)
  })

  it('still refuses BEFORE generating if the balance cannot be read', async () => {
    const app = await getApp()
    grant(null)
    dbMock.user.findUniqueOrThrow.mockRejectedValue(new Error('db down') as never)
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'high press trap' },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(500)
    // Crucially, we never called the model.
    expect(gemini.generate).not.toHaveBeenCalled()
  })
})

describe('allowance accounting', () => {
  it('free retries are excluded from the used count', async () => {
    const app = await getApp()
    grant(null)
    await app.inject({
      method: 'GET',
      url: '/api/canvas/ai-credits',
      headers: authHeaders(await accessToken()),
    })
    const where = dbMock.aiUsage.count.mock.calls.at(-1)![0].where
    expect(where.freeRetry).toBe(false)
  })
})
