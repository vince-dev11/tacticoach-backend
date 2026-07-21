// Football-validity validators + the corrective-retry loop.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'
import { validateLayout, validateAnimation, validateReelCopy } from '../src/modules/ai/ai.validate.js'
import type { CleanItem } from '../src/modules/ai/ai.schema.js'

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

const p = (ref: string, x: number, y: number, label?: string, key = 'player_blue'): CleanItem => ({
  ref, key, type: 'player', x, y, ...(label ? { props: { label } } : {}),
})

describe('validateLayout', () => {
  it('accepts a sane spread-out layout', () => {
    expect(validateLayout([p('gk', 80, 360, 'GK'), p('h9', 900, 300, '9'), p('h7', 700, 500, '7')], 'high press')).toEqual([])
  })

  it('flags two goalkeepers on one team', () => {
    const issues = validateLayout([p('a', 80, 360, 'GK'), p('b', 200, 300, 'GK')], 'setup')
    expect(issues.join(' ')).toMatch(/2 goalkeepers/)
  })

  it('flags overlapping players', () => {
    const issues = validateLayout([p('a', 400, 400, '5'), p('b', 405, 405, '6')], 'setup')
    expect(issues.join(' ')).toMatch(/overlap/)
  })

  it('flags a 4-3-3 with the wrong outfield count', () => {
    const team = [p('gk', 80, 360, 'GK'), ...Array.from({ length: 9 }, (_, i) => p(`o${i}`, 200 + i * 90, 100 + (i % 3) * 220, String(i + 2)))]
    const issues = validateLayout(team, '4-3-3 high press')
    expect(issues.join(' ')).toMatch(/needs 10 outfield/)
  })
})

describe('validateAnimation', () => {
  it('flags teleporting moves and empty animations', () => {
    const objs = [p('h9', 100, 360, '9')]
    expect(validateAnimation(objs, [], 'x').join(' ')).toMatch(/no movement/)
    const issues = validateAnimation(objs, [{ moves: [{ ref: 'h9', to: { x: 1300, y: 100 } }] }], 'x')
    expect(issues.join(' ')).toMatch(/moves \d+px/)
  })
})

describe('validateReelCopy', () => {
  const good = {
    title: 'High Press Buildup', subtitle: 'Trigger analysis', quote: 'Win it in their half',
    quoteDetail: 'Cut the pivot early.', stats: [{ value: '87%', label: 'Press rate' }],
    tags: ['4-3-3'], hashtags: '#football #tactics',
  }
  it('accepts clean copy', () => expect(validateReelCopy(good)).toEqual([]))
  it('flags markdown junk and prose stats', () => {
    expect(validateReelCopy({ ...good, title: '**High** press' }).join(' ')).toMatch(/markdown/)
    expect(validateReelCopy({ ...good, stats: [{ value: 'about seven', label: 'x' }] }).join(' ')).toMatch(/short figure/)
    expect(validateReelCopy({ ...good, hashtags: 'football tactics' }).join(' ')).toMatch(/must start with #/)
  })
})

describe('corrective retry loop', () => {
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

  it('feeds validation issues back and uses the corrected output', async () => {
    const app = await getApp()
    grant()
    const twoGks = {
      summary: 'setup',
      objects: [
        { ref: 'a', key: 'player_blue', type: 'player', x: 80, y: 360, props: { label: 'GK' } },
        { ref: 'b', key: 'player_blue', type: 'player', x: 300, y: 300, props: { label: 'GK' } },
      ],
    }
    const fixed = {
      summary: 'setup',
      objects: [
        { ref: 'a', key: 'player_blue', type: 'player', x: 80, y: 360, props: { label: 'GK' } },
        { ref: 'b', key: 'player_blue', type: 'player', x: 300, y: 300, props: { label: '5' } },
      ],
    }
    gemini.generate.mockResolvedValueOnce(twoGks).mockResolvedValueOnce(fixed)

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'defensive setup' },
    })
    expect(res.statusCode).toBe(200)
    expect(gemini.generate).toHaveBeenCalledTimes(2)
    // The corrective prompt quotes the problem back to the model.
    const secondUserPrompt = gemini.generate.mock.calls[1][1]
    expect(secondUserPrompt).toMatch(/2 goalkeepers/)
    // The corrected (single-GK) output is what the coach receives.
    const labels = res.json().layout.map((o: { props?: { label?: string } }) => o.props?.label)
    expect(labels.filter((l: string) => l === 'GK')).toHaveLength(1)
  })

  it('accepts the first output when correction also fails (editor is the safety net)', async () => {
    const app = await getApp()
    grant()
    const overlapping = {
      summary: 'setup',
      objects: [
        { ref: 'a', key: 'player_blue', type: 'player', x: 400, y: 400, props: { label: '5' } },
        { ref: 'b', key: 'player_blue', type: 'player', x: 404, y: 404, props: { label: '6' } },
      ],
    }
    gemini.generate.mockResolvedValue(overlapping) // both attempts imperfect

    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas/ai-layout',
      headers: authHeaders(await accessToken()),
      payload: { prompt: 'pairing drill' },
    })
    expect(res.statusCode).toBe(200) // soft issues never become a 502
    expect(gemini.generate).toHaveBeenCalledTimes(2)
  })
})
