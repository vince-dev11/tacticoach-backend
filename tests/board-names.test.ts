// NAMES-ALL (owner, 17 Nov 2026): "Hide all player names". A team whose names
// are hidden (nameplate 'none' or 'role') has them taken OUT of the board's
// data when the board is served to anyone but its owner — hidden on screen is
// not enough on a public board. Names left showing are served as drawn.
import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { stripHiddenNames } from '../src/lib/board-names.js'

const player = (key: string, name: string) => ({ tcType: 'player', tcKey: key, tcProps: { label: '9', name } })
const board = (styles: Record<string, { nameplate?: string }>, steps?: unknown[]) => ({
  canvas: {
    version: '5.3.0',
    objects: [player('player_blue', 'Ava'), player('player_red', 'Ben'), player('player_yellow', 'Cy'), { tcType: 'football', tcKey: 'white_ball' }],
    tcMeta: { teamStyles: styles, ...(steps ? { steps } : {}) },
  },
  frames: [],
})
const names = (s: unknown) => (s as ReturnType<typeof board>).canvas.objects.map((o) => (o as { tcProps?: { name?: string } }).tcProps?.name)

describe('NAMES-ALL · stripHiddenNames', () => {
  it('all teams hidden: no name is left in the data; numbers stay', () => {
    const out = stripHiddenNames(board({ home: { nameplate: 'none' }, away: { nameplate: 'none' }, neutral: { nameplate: 'none' } }))
    expect(names(out)).toEqual([undefined, undefined, undefined, undefined])
    expect((out.canvas.objects[0] as { tcProps: { label: string } }).tcProps.label).toBe('9')
    expect(JSON.stringify(out)).not.toMatch(/Ava|Ben|Cy/)
  })

  it('only the hidden teams lose their names; positions-only ("role") counts as hidden; the default shows', () => {
    const out = stripHiddenNames(board({ home: { nameplate: 'role' }, away: {} }))
    expect(names(out)).toEqual([undefined, 'Ben', 'Cy', undefined])
  })

  it('the other steps of a practice are stripped too, and the original is never changed', () => {
    const inner = board({ home: { nameplate: 'none' }, away: { nameplate: 'none' }, neutral: { nameplate: 'none' } })
    const src = board({ home: { nameplate: 'none' }, away: { nameplate: 'none' }, neutral: { nameplate: 'none' } }, [{ name: 'Harder', board: inner }])
    const out = stripHiddenNames(src)
    expect(JSON.stringify(out)).not.toMatch(/Ava|Ben|Cy/)
    expect(JSON.stringify(src)).toMatch(/Ava/)
  })

  it('anything unexpected comes back untouched', () => {
    expect(stripHiddenNames(null)).toBeNull()
    expect(stripHiddenNames({})).toEqual({})
    expect(stripHiddenNames({ canvas: { objects: 'x' } })).toEqual({ canvas: { objects: 'x' } })
  })
})

describe('NAMES-ALL · GET /api/canvas/boards/:id', () => {
  const state = board({ home: { nameplate: 'none' }, away: { nameplate: 'none' }, neutral: { nameplate: 'none' } })
  it('another coach gets the public board without the hidden names; the owner gets their own names', async () => {
    const app = await getApp()
    const me = Number(JSON.parse(Buffer.from((await accessToken()).split('.')[1], 'base64url').toString()).sub)
    dbMock.canvasBoard.findFirst.mockResolvedValue({ id: 9, userId: me + 1, title: 'Shape', published: true, state } as never)
    const other = await app.inject({ method: 'GET', url: '/api/canvas/boards/9', headers: authHeaders(await accessToken()) })
    expect(other.statusCode).toBe(200)
    expect(other.body).not.toMatch(/Ava|Ben|Cy/)
    dbMock.canvasBoard.findFirst.mockResolvedValue({ id: 9, userId: me, title: 'Shape', published: true, state } as never)
    const own = await app.inject({ method: 'GET', url: '/api/canvas/boards/9', headers: authHeaders(await accessToken()) })
    expect(own.body).toMatch(/Ava/)
  })
})
