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
