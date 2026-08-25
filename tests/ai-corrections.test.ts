// Coach corrections — the learning loop's intake and its consumer.
//
// Two properties matter more than the features: recording must never hurt the
// save it rides on (always 204, even when everything goes wrong), and what we
// store must be the diff, never the coach's board.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'
import {
  CorrectionDiffSchema,
  correctionAggregates,
  isWorthKeeping,
  type CorrectionDiff,
} from '../src/modules/ai/ai.corrections.js'

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
  dbMock.aiCorrection.create.mockResolvedValue({} as never)
}

const diff: CorrectionDiff = {
  moved: [{ key: 'player_blue', from: { x: 300, y: 300 }, to: { x: 300, y: 480 } }],
  added: [],
  removed: [{ key: 'cone-1', x: 200, y: 200 }],
  redrawnMovements: 1,
  rejected: false,
}

const payload = {
  source: 'gemini',
  concept: 'high_press',
  quality: 55,
  context: 'Under 9 · 7-a-side · Grassroots',
  diff,
}

beforeEach(() => {
  gemini.configured = true
  gemini.generate.mockReset()
})

describe('POST /ai-correction', () => {
  it('stores the diff with its aggregates', async () => {
    const app = await getApp()
    grant()
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-correction',
      headers: authHeaders(await accessToken()),
      payload,
    })
    expect(res.statusCode).toBe(204)
    expect(dbMock.aiCorrection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'gemini',
          concept: 'high_press',
          quality: 55,
          movedCount: 1,
          removedCount: 1,
          meanShift: 180,
        }),
      }),
    )
  })

  it('never stores the board — only the diff shape is accepted', async () => {
    // A client bug (or a mischievous client) sending the whole board must not
    // end up in the table. Unknown keys are stripped; a diff that is actually
    // a board fails the schema and the row is simply not written.
    const app = await getApp()
    grant()
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-correction',
      headers: authHeaders(await accessToken()),
      payload: {
        ...payload,
        diff: { objects: [{ ref: 'h1', x: 1, y: 2 }], frames: [] }, // a board, not a diff
      },
    })
    expect(res.statusCode).toBe(204) // still no error surfaced to the save
    expect(dbMock.aiCorrection.create).not.toHaveBeenCalled()
  })

  it('drops a diff with nothing in it', async () => {
    const app = await getApp()
    grant()
    await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-correction',
      headers: authHeaders(await accessToken()),
      payload: {
        ...payload,
        diff: { moved: [], added: [], removed: [], redrawnMovements: 0, rejected: false },
      },
    })
    expect(dbMock.aiCorrection.create).not.toHaveBeenCalled()
  })

  it('returns 204 even when the database write explodes', async () => {
    // The correction rides on a coach's save. A telemetry failure that broke
    // saving would cost us far more than the lost row.
    const app = await getApp()
    grant()
    dbMock.aiCorrection.create.mockRejectedValue(new Error('table missing') as never)
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-correction',
      headers: authHeaders(await accessToken()),
      payload,
    })
    expect(res.statusCode).toBe(204)
  })

  it('a rejection with no detail is still worth a row', async () => {
    const app = await getApp()
    grant()
    await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-correction',
      headers: authHeaders(await accessToken()),
      payload: {
        ...payload,
        diff: { moved: [], added: [], removed: [], redrawnMovements: 0, rejected: true },
      },
    })
    expect(dbMock.aiCorrection.create).toHaveBeenCalled()
  })
})

describe('GET /ai-corrections/summary', () => {
  it('is owner-only — corrections are product telemetry, not user data', async () => {
    const app = await getApp()
    grant()
    dbMock.user.findUnique.mockResolvedValue({ role: 'user' } as never)
    const res = await app.inject({
      method: 'GET',
      url: '/api/canvas/ai-corrections/summary',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('ranks concepts by correction volume — the pattern build queue', async () => {
    const app = await getApp()
    grant()
    dbMock.user.findUnique.mockResolvedValue({ role: 'owner' } as never)
    dbMock.aiCorrection.groupBy.mockResolvedValue([
      {
        concept: 'high_press',
        source: 'gemini',
        _count: { _all: 14 },
        _avg: { movedCount: 3.2, meanShift: 120, quality: 58 },
      },
      {
        concept: 'rondo',
        source: 'dsl',
        _count: { _all: 2 },
        _avg: { movedCount: 1, meanShift: 40, quality: 90 },
      },
    ] as never)
    const res = await app.inject({
      method: 'GET',
      url: '/api/canvas/ai-corrections/summary?days=14',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.days).toBe(14)
    expect(body.concepts[0]).toEqual({
      concept: 'high_press',
      source: 'gemini',
      corrections: 14,
      avgObjectsMoved: 3.2,
      avgShiftUnits: 120,
      avgQualityWhenCorrected: 58,
    })
  })
})

describe('the diff schema and helpers', () => {
  it('caps list sizes so a pathological client cannot store megabytes', () => {
    const huge = {
      moved: Array.from({ length: 100 }, () => ({
        key: 'player_blue',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
      })),
      added: [],
      removed: [],
      redrawnMovements: 0,
      rejected: false,
    }
    expect(CorrectionDiffSchema.safeParse(huge).success).toBe(false)
  })

  it('mean shift is the average distance moved, rounded to canvas units', () => {
    const agg = correctionAggregates({
      moved: [
        { key: 'a', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
        { key: 'b', from: { x: 0, y: 0 }, to: { x: 0, y: 300 } },
      ],
      added: [],
      removed: [],
      redrawnMovements: 0,
      rejected: false,
    })
    expect(agg.meanShift).toBe(200)
    expect(agg.movedCount).toBe(2)
  })

  it('an empty diff is not worth keeping; any single change is', () => {
    const empty: CorrectionDiff = { moved: [], added: [], removed: [], redrawnMovements: 0, rejected: false }
    expect(isWorthKeeping(empty)).toBe(false)
    expect(isWorthKeeping({ ...empty, redrawnMovements: 1 })).toBe(true)
    expect(isWorthKeeping({ ...empty, rejected: true })).toBe(true)
  })
})
