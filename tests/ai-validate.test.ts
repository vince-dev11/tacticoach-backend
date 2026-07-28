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

describe('small-sided games', () => {
  it('flags a 3v3 with a full team of players', () => {
    const team = Array.from({ length: 14 }, (_, i) => p(`x${i}`, 100 + i * 80, 100 + (i % 4) * 150, String(i + 1)))
    const issues = validateLayout(team, 'Move As A Team | 3 VS. 3 | High Pressing & Overloads')
    expect(issues.join(' ')).toMatch(/3v3.*needs 6 players/)
  })
  it('accepts a correct 3v3 (6 players + cones implied elsewhere)', () => {
    const six = Array.from({ length: 6 }, (_, i) => p(`x${i}`, 300 + (i % 3) * 180, 200 + Math.floor(i / 3) * 250, String(i + 1), i < 3 ? 'player_blue' : 'player_red'))
    expect(validateLayout(six, '3 vs 3 high pressing drill')).toEqual([])
  })
})

describe('validateAnimation', () => {
  const ball = (x: number, y: number): CleanItem => ({ ref: 'ball', key: 'white_ball', type: 'football', x, y })

  it('flags teleporting moves and empty animations', () => {
    const objs = [p('h9', 100, 360, '9')]
    expect(validateAnimation(objs, [], 'x').join(' ')).toMatch(/no movement/)
    const issues = validateAnimation(objs, [{ moves: [{ ref: 'h9', to: { x: 1300, y: 100 } }] }], 'x')
    expect(issues.join(' ')).toMatch(/moves \d+px/)
  })

  it('flags a static ball in a passing animation (multi-language)', () => {
    const objs = [p('h9', 100, 360, '9'), p('h7', 400, 200, '7'), ball(120, 360)]
    const frames = [{ moves: [{ ref: 'h9', to: { x: 300, y: 300 } }] }]
    expect(validateAnimation(objs, frames, 'passing pattern through the thirds').join(' ')).toMatch(/ball never moves/)
    expect(validateAnimation(objs, frames, 'salida de balón con pases cortos').join(' ')).toMatch(/ball never moves/)
    // No ball-action words → no complaint.
    expect(validateAnimation(objs, frames, 'pressing shape shift').join(' ')).not.toMatch(/ball never moves/)
  })

  it('accepts when the ball travels', () => {
    const objs = [p('h9', 100, 360, '9'), ball(120, 360)]
    const frames = [{ moves: [{ ref: 'h9', to: { x: 300, y: 300 } }, { ref: 'ball', to: { x: 305, y: 305 } }] }]
    expect(validateAnimation(objs, frames, 'passing move').join(' ')).not.toMatch(/ball never moves/)
  })

  it('flags fewer frames than named phases', () => {
    const objs = [p('h9', 100, 360, '9')]
    const frames = [{ moves: [{ ref: 'h9', to: { x: 300, y: 300 } }] }]
    expect(validateAnimation(objs, frames, 'counter attack in 3 phases').join(' ')).toMatch(/3 phases but you produced 1/)
    expect(validateAnimation(objs, frames, 'kontra in drei Phasen — 3 Phasen').join(' ')).toMatch(/3 phases/)
  })

  it('flags a statue team (≥8 players, only one moves)', () => {
    const team = Array.from({ length: 10 }, (_, i) => p(`x${i}`, 150 + i * 100, 150 + (i % 4) * 130, String(i + 1)))
    const frames = [{ moves: [{ ref: 'x0', to: { x: 400, y: 400 } }] }]
    expect(validateAnimation(team, frames, 'team pressing rotation').join(' ')).toMatch(/only 1 of 10 players ever move/)
  })

  it('flags a ball abandoned in space (one-ball-owner rule)', () => {
    const objs = [p('h9', 100, 360, '9'), ball(120, 360)]
    const frames = [{ moves: [{ ref: 'ball', to: { x: 700, y: 360 } }, { ref: 'h9', to: { x: 200, y: 360 } }] }]
    expect(validateAnimation(objs, frames, 'x').join(' ')).toMatch(/nearest player/)
  })

  it('allows a finish into the goalmouth without an owner', () => {
    const objs = [p('h9', 1100, 360, '9'), ball(1120, 360)]
    const frames = [{ moves: [{ ref: 'ball', to: { x: 1340, y: 360 } }, { ref: 'h9', to: { x: 1180, y: 350 } }] }]
    expect(validateAnimation(objs, frames, 'shot on goal').join(' ')).not.toMatch(/nearest player/)
  })

  it('flags padding frames with no real movement', () => {
    const objs = [p('h9', 100, 360, '9')]
    const frames = [
      { moves: [{ ref: 'h9', to: { x: 300, y: 360 } }] },
      { moves: [{ ref: 'h9', to: { x: 302, y: 361 } }] },
    ]
    expect(validateAnimation(objs, frames, 'x').join(' ')).toMatch(/frame 2 contains no real movement/)
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
