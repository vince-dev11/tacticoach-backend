// Session Builder API — CRUD, ownership, entitlement, and block validation.

import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, activeSubscription } from './helpers.js'

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    title: 'U12 build-out vs press',
    sessionDate: new Date('2026-08-28'),
    ageGroup: 'U12',
    targetMinutes: 90,
    blocks: [
      { kind: 'board', refId: 5, title: 'Rondo 5v2', minutes: 15 },
      { kind: 'text', title: 'Water break', minutes: 5 },
    ],
    brand: { color: '#00a76f' },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function grantEditorAccess() {
  dbMock.userSubscription.findUnique.mockResolvedValue(activeSubscription() as never)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
}

/** A coach inside the 14-day free trial (FT-2): three sessions, counted by creation. */
function onFreeTier() {
  dbMock.user.findUnique.mockResolvedValue({ role: 'user', accountType: 'coach', freeTrialEndsAt: new Date(Date.now() + 5 * 86_400_000) } as never)
  dbMock.freeUsage.upsert.mockResolvedValue({} as never)
  dbMock.userSubscription.findUnique.mockResolvedValue(null)
  dbMock.clubMember.findUnique.mockResolvedValue(null)
  dbMock.club.findUnique.mockResolvedValue(null)
}

describe('GET /api/sessions', () => {
  it('requires auth', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/sessions' })
    expect(res.statusCode).toBe(401)
  })

  it('lists only my sessions', async () => {
    const app = await getApp()
    dbMock.trainingSession.findMany.mockResolvedValue([sessionRow()] as never)

    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
    expect(dbMock.trainingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1 } }),
    )
  })
})

describe('POST /api/sessions', () => {
  it('lets a free-trial coach save a session while a slot is left', async () => {
    const app = await getApp()
    onFreeTier()
    dbMock.$executeRaw.mockResolvedValue(1 as never)
    dbMock.trainingSession.create.mockResolvedValue(sessionRow() as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(await accessToken()),
      payload: { title: 'My one session' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('refuses their second with a 402', async () => {
    const app = await getApp()
    onFreeTier()
    dbMock.trainingSession.count.mockResolvedValue(1 as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(await accessToken()),
      payload: { title: 'Session two' },
    })
    expect(res.statusCode).toBe(402)
    expect(dbMock.trainingSession.create).not.toHaveBeenCalled()
  })

  it('creates a session with blocks and brand colour', async () => {
    const app = await getApp()
    grantEditorAccess()
    dbMock.trainingSession.create.mockResolvedValue(sessionRow() as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(await accessToken()),
      payload: {
        title: 'U12 build-out vs press',
        ageGroup: 'U12',
        targetMinutes: 90,
        blocks: [
          { kind: 'board', refId: 5, title: 'Rondo 5v2', minutes: 15 },
          { kind: 'text', title: 'Water break', minutes: 5 },
        ],
        brand: { color: '#00a76f' },
      },
    })
    expect(res.statusCode).toBe(201)
    expect(dbMock.trainingSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 1, brand: { color: '#00a76f' } }),
      }),
    )
  })

  it('rejects an invalid brand colour with 422', async () => {
    const app = await getApp()
    grantEditorAccess()
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(await accessToken()),
      payload: { title: 'Bad brand', brand: { color: 'greenish' } },
    })
    expect(res.statusCode).toBe(422)
  })

  it('keeps an exercise drawn in the session: its pitch and its area', async () => {
    const app = await getApp()
    grantEditorAccess()
    const board = { canvas: { version: '5', objects: [{ tcType: 'pitch', tcKey: 'pitch_2' }] }, frames: [] }
    dbMock.trainingSession.create.mockResolvedValue(sessionRow() as never)
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(await accessToken()),
      payload: { title: 'Drawn', blocks: [{ kind: 'drill', title: 'Rondo', minutes: 12, part: 0, board, area: '20 × 20 m' }] },
    })
    expect(res.statusCode).toBe(201)
    const saved = (dbMock.trainingSession.create.mock.calls.at(-1)![0] as { data: { blocks: unknown[] } }).data.blocks[0]
    expect(saved).toMatchObject({ kind: 'drill', area: '20 × 20 m', board: { canvas: { objects: [{ tcKey: 'pitch_2' }] } } })
  })

  it('PR-4 · keeps practice type, numbers, progression and regression on a block', async () => {
    const app = await getApp()
    grantEditorAccess()
    dbMock.trainingSession.create.mockResolvedValue(sessionRow() as never)
    const block = {
      kind: 'text', title: 'Rondo', minutes: 12, part: 0,
      practiceType: 'rondo', numbers: '4v4+2', progression: 'Two touch', regression: 'Add a floater',
      successCriteria: '3 switches before scoring',
    }
    const res = await app.inject({ method: 'POST', url: '/api/sessions', headers: authHeaders(await accessToken()), payload: { title: 'Typed', blocks: [block] } })
    expect(res.statusCode).toBe(201)
    const saved = (dbMock.trainingSession.create.mock.calls.at(-1)![0] as { data: { blocks: unknown[] } }).data.blocks[0]
    expect(saved).toMatchObject({ practiceType: 'rondo', numbers: '4v4+2', progression: 'Two touch', regression: 'Add a floater' })
    // PD-1: success criteria are kept too.
    expect(saved).toMatchObject({ successCriteria: '3 switches before scoring' })

    const bad = await app.inject({ method: 'POST', url: '/api/sessions', headers: authHeaders(await accessToken()), payload: { title: 'Bad', blocks: [{ ...block, practiceType: 'Rondo!' }] } })
    expect(bad.statusCode).toBe(422)
  })

  it('refuses a drawing that is not a board', async () => {
    const app = await getApp()
    grantEditorAccess()
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(await accessToken()),
      payload: { title: 'Bad', blocks: [{ kind: 'drill', title: 'X', minutes: 5, board: { hello: 1 } }] },
    })
    expect(res.statusCode).toBe(422)
  })

  it('rejects a block with an unknown kind', async () => {
    const app = await getApp()
    grantEditorAccess()
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(await accessToken()),
      payload: { title: 'Bad block', blocks: [{ kind: 'video', title: 'X', minutes: 10 }] },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('GET/PATCH/DELETE /api/sessions/:id', () => {
  it("404s for someone else's session (ownership in the query)", async () => {
    const app = await getApp()
    dbMock.trainingSession.findFirst.mockResolvedValue(null)
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/99',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(404)
    expect(dbMock.trainingSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99, userId: 1 } }),
    )
  })

  it('updates blocks on my session', async () => {
    const app = await getApp()
    grantEditorAccess()
    dbMock.trainingSession.findFirst.mockResolvedValue({ id: 1 } as never)
    dbMock.trainingSession.update.mockResolvedValue(sessionRow() as never)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/1',
      headers: authHeaders(await accessToken()),
      payload: { blocks: [{ kind: 'sheet', refId: 2, title: 'Finishing waves', minutes: 20 }] },
    })
    expect(res.statusCode).toBe(200)
  })

  it('deletes my session', async () => {
    const app = await getApp()
    dbMock.trainingSession.findFirst.mockResolvedValue({ id: 1 } as never)
    dbMock.trainingSession.delete.mockResolvedValue(sessionRow() as never)

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/sessions/1',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('Fixtures (migration 37)', () => {
  it('a free coach at the session limit can still add a match — fixtures are not training content', async () => {
    const app = await getApp()
    onFreeTier()
    dbMock.$executeRaw.mockResolvedValue(0 as never) // every slot spent
    dbMock.trainingSession.create.mockResolvedValue(sessionRow({ isMatch: true }) as never)
    const res = await app.inject({
      method: 'POST', url: '/api/sessions', headers: authHeaders(await accessToken()),
      payload: { title: 'vs Riverside', isMatch: true, sessionType: 'match', opponent: 'Riverside FC', homeAway: 'away', competition: 'League', startTime: '10:30' },
    })
    expect(res.statusCode).toBe(201)
    const data = (dbMock.trainingSession.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data).toMatchObject({ isMatch: true, opponent: 'Riverside FC', homeAway: 'away', competition: 'League' })
  })

  it('the session limit counts training only, never matches', async () => {
    const app = await getApp()
    onFreeTier()
    dbMock.trainingSession.create.mockResolvedValue(sessionRow({ isMatch: true }) as never)
    await app.inject({ method: 'POST', url: '/api/sessions', headers: authHeaders(await accessToken()), payload: { title: 'vs Riverside', isMatch: true, sessionType: 'match', opponent: 'Riverside FC' } })
    expect(dbMock.$executeRaw).not.toHaveBeenCalled() // a match spends no slot
    dbMock.$executeRaw.mockResolvedValue(1 as never)
    dbMock.trainingSession.create.mockResolvedValue(sessionRow() as never)
    await app.inject({ method: 'POST', url: '/api/sessions', headers: authHeaders(await accessToken()), payload: { title: 'Tuesday' } })
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1) // training does
  })

  it('entering the result later writes only the result', async () => {
    const app = await getApp()
    grantEditorAccess()
    dbMock.trainingSession.findFirst.mockResolvedValue({ id: 1 } as never)
    dbMock.trainingSession.update.mockResolvedValue(sessionRow({ isMatch: true }) as never)
    const res = await app.inject({
      method: 'PATCH', url: '/api/sessions/1', headers: authHeaders(await accessToken()),
      payload: { goalsFor: 3, goalsAgainst: 1, matchNote: '  Pressed well, tired late.  ' },
    })
    expect(res.statusCode).toBe(200)
    const data = (dbMock.trainingSession.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data).toEqual({ goalsFor: 3, goalsAgainst: 1, matchNote: 'Pressed well, tired late.' })
  })

  it('rejects nonsense: an unknown home/away value or a negative score', async () => {
    const app = await getApp()
    grantEditorAccess()
    dbMock.trainingSession.findFirst.mockResolvedValue({ id: 1 } as never)
    const bad1 = await app.inject({ method: 'PATCH', url: '/api/sessions/1', headers: authHeaders(await accessToken()), payload: { homeAway: 'neutral' } })
    const bad2 = await app.inject({ method: 'PATCH', url: '/api/sessions/1', headers: authHeaders(await accessToken()), payload: { goalsFor: -1 } })
    expect(bad1.statusCode).toBe(422)
    expect(bad2.statusCode).toBe(422)
  })
})

describe('PATCH touches only what was sent', () => {
  it('adding a drill (blocks only) keeps the brand colour — it used to be reset to {}', async () => {
    const app = await getApp()
    grantEditorAccess()
    dbMock.trainingSession.findFirst.mockResolvedValue({ id: 1 } as never)
    dbMock.trainingSession.update.mockResolvedValue(sessionRow() as never)
    await app.inject({
      method: 'PATCH', url: '/api/sessions/1', headers: authHeaders(await accessToken()),
      payload: { blocks: [{ kind: 'text', title: 'Rondo', minutes: 10 }] },
    })
    const data = (dbMock.trainingSession.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(Object.keys(data)).toEqual(['blocks'])
  })
})

describe('B-PT1 · practice types are the client\'s camelCase ids', () => {
  it.each(['oneVone', 'buildUp', 'phaseOfPlay', 'positionGame', 'setPiece', 'rondo'])('saves a block typed %s', async (practiceType) => {
    const app = await getApp()
    grantEditorAccess()
    dbMock.trainingSession.create.mockResolvedValue(sessionRow() as never)
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(await accessToken()),
      payload: { title: '1v1 — beat a player · 7v7', blocks: [{ kind: 'text', title: '1v1: 1v1 to mini goals', minutes: 22, part: 1, practiceType }] },
    })
    expect(res.statusCode).toBe(201)
  })

  it('still refuses something that is not an id', async () => {
    const app = await getApp()
    grantEditorAccess()
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(await accessToken()),
      payload: { title: 'x', blocks: [{ kind: 'text', title: 'x', minutes: 5, practiceType: '<script>' }] },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('SEASON-2 · a session has a one-line description', () => {
  it('saves it on create, trims it, and stores a blank as null', async () => {
    const app = await getApp()
    grantEditorAccess()
    dbMock.trainingSession.create.mockResolvedValue(sessionRow() as never)
    let res = await app.inject({ method: 'POST', url: '/api/sessions', headers: authHeaders(await accessToken()), payload: { title: 'Pressing', description: '  Win it back in 5 seconds  ' } })
    expect(res.statusCode).toBe(201)
    expect(dbMock.trainingSession.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ description: 'Win it back in 5 seconds' }) }))
    res = await app.inject({ method: 'POST', url: '/api/sessions', headers: authHeaders(await accessToken()), payload: { title: 'x', description: '   ' } })
    expect(dbMock.trainingSession.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ description: null }) }))
  })

  it('refuses more than 300 characters', async () => {
    const app = await getApp()
    grantEditorAccess()
    const res = await app.inject({ method: 'POST', url: '/api/sessions', headers: authHeaders(await accessToken()), payload: { title: 'x', description: 'a'.repeat(301) } })
    expect(res.statusCode).toBe(422)
  })

  it('a PATCH without it leaves it alone; with it, updates it', async () => {
    const app = await getApp()
    grantEditorAccess()
    dbMock.trainingSession.findFirst.mockResolvedValue({ id: 1 } as never)
    dbMock.trainingSession.update.mockResolvedValue(sessionRow() as never)
    await app.inject({ method: 'PATCH', url: '/api/sessions/1', headers: authHeaders(await accessToken()), payload: { title: 'Renamed' } })
    expect((dbMock.trainingSession.update.mock.calls.at(-1)![0] as { data: object }).data).not.toHaveProperty('description')
    await app.inject({ method: 'PATCH', url: '/api/sessions/1', headers: authHeaders(await accessToken()), payload: { description: 'New line' } })
    expect((dbMock.trainingSession.update.mock.calls.at(-1)![0] as { data: { description: string } }).data.description).toBe('New line')
  })
})
