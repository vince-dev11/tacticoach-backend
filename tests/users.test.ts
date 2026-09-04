import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, userRow } from './helpers.js'

describe('GET /api/users/me', () => {
  it('requires auth', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/users/me' })
    expect(res.statusCode).toBe(401)
  })

  it('returns the profile', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(userRow() as never)

    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().email).toBe('coach@test.dev')
  })

  it('404s when the user row is gone', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(null)

    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /api/users/me', () => {
  it('updates profile fields', async () => {
    const app = await getApp()
    dbMock.user.update.mockResolvedValue(userRow({ clubName: 'FC Test' }) as never)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers: authHeaders(await accessToken()),
      payload: { clubName: 'FC Test' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().clubName).toBe('FC Test')
  })

  it('rejects invalid social URLs with 422', async () => {
    const app = await getApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers: authHeaders(await accessToken()),
      payload: { instagramUrl: 'not-a-url' },
    })
    expect(res.statusCode).toBe(422)
  })

  it('accepts an empty string to clear a social URL', async () => {
    const app = await getApp()
    dbMock.user.update.mockResolvedValue(userRow() as never)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers: authHeaders(await accessToken()),
      payload: { instagramUrl: '' },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /health', () => {
  it('responds ok without auth', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ok')
  })
})

describe('POST /api/users/me/tours', () => {
  it('requires auth', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/users/me/tours', payload: { tour: 'editor' } })
    expect(res.statusCode).toBe(401)
  })

  it('records a completed tour on the account', async () => {
    const app = await getApp()
    dbMock.user.findUniqueOrThrow.mockResolvedValue({ toursDone: [] } as never)
    dbMock.user.update.mockResolvedValue(userRow() as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/users/me/tours',
      headers: authHeaders(await accessToken()),
      payload: { tour: 'editor' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().toursDone).toEqual(['editor'])
    expect(dbMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { toursDone: ['editor'] } }),
    )
  })

  it('is idempotent — completing the same tour twice never duplicates it', async () => {
    const app = await getApp()
    dbMock.user.findUniqueOrThrow.mockResolvedValue({ toursDone: ['editor'] } as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/users/me/tours',
      headers: authHeaders(await accessToken()),
      payload: { tour: 'editor' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().toursDone).toEqual(['editor'])
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it('rejects unknown tour ids with 422', async () => {
    const app = await getApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/users/me/tours',
      headers: authHeaders(await accessToken()),
      payload: { tour: 'space-mission' },
    })
    expect(res.statusCode).toBe(422)
  })
})

// ---- My Squad ---------------------------------------------------------------
// The generated client in CI may predate the SquadPlayer model; the deep mock
// proxies any property at runtime, so we reach it through a loose cast.
const squadMock = () => (dbMock as unknown as {
  squadPlayer: {
    findMany: { mockResolvedValue: (v: unknown) => void }
    deleteMany: { mockResolvedValue: (v: unknown) => void }
    createMany: { mockResolvedValue: (v: unknown) => void }
  }
}).squadPlayer

describe('GET /api/users/me/squad', () => {
  it('requires auth', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/users/me/squad' })
    expect(res.statusCode).toBe(401)
  })

  it('returns the squad in order', async () => {
    const app = await getApp()
    squadMock().findMany.mockResolvedValue([
      { id: 1, name: 'Leo Keeper', number: '1', position: 'GK', sortOrder: 0 },
      { id: 2, name: 'Musa Nine', number: '9', position: 'FW', sortOrder: 1 },
    ])
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me/squad',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().players).toHaveLength(2)
    expect(res.json().players[0].name).toBe('Leo Keeper')
  })
})

describe('PUT /api/users/me/squad', () => {
  it('replaces the squad and returns the saved list', async () => {
    const app = await getApp()
    dbMock.$transaction.mockResolvedValue([] as never)
    squadMock().findMany.mockResolvedValue([
      { id: 3, name: 'Leo Keeper', number: '1', position: 'GK', sortOrder: 0 },
    ])
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/squad',
      headers: authHeaders(await accessToken()),
      payload: { players: [{ name: 'Leo Keeper', number: '1', position: 'GK' }] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().players[0].position).toBe('GK')
  })

  it('rejects an unknown position', async () => {
    const app = await getApp()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/squad',
      headers: authHeaders(await accessToken()),
      payload: { players: [{ name: 'X', number: '1', position: 'STRIKER' }] },
    })
    expect(res.statusCode).toBe(422)
  })

  it('caps the squad at 30 players', async () => {
    const app = await getApp()
    const players = Array.from({ length: 31 }, (_, i) => ({ name: `P${i}`, number: String(i) }))
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/squad',
      headers: authHeaders(await accessToken()),
      payload: { players },
    })
    expect(res.statusCode).toBe(422)
  })
})
