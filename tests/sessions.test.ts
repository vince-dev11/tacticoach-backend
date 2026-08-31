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

function revokeEditorAccess() {
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
  it('blocks users without editor access', async () => {
    const app = await getApp()
    revokeEditorAccess()
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(await accessToken()),
      payload: { title: 'Blocked session' },
    })
    expect(res.statusCode).toBe(403)
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
