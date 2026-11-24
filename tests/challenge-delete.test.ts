// CHALLENGE-DELETE (24 Nov 2026): the owner can delete a challenge published
// by mistake, and the same challenge can't be published twice.

import { beforeEach, describe, expect, it } from 'vitest'
import { dbMock } from './setup.js'
import { accessToken, authHeaders, getApp } from './helpers.js'

const headers = async () => authHeaders(await accessToken(1))
const body = { title: 'Beat the press from a goal kick', prompt: 'Play out against a 3-man press.', tag: 'build-out', startsAt: '2026-11-24T19:00', endsAt: '2026-12-01T19:00' }

beforeEach(() => {
  dbMock.user.findUnique.mockResolvedValue({ role: 'owner' } as never)
})

describe('CHALLENGE-DELETE · DELETE /api/challenges/:id', () => {
  it('deletes the challenge and says how many entries went with it', async () => {
    dbMock.challenge.findUnique.mockResolvedValue({ id: 7, _count: { submissions: 2 } } as never)
    dbMock.challenge.delete.mockResolvedValue({ id: 7 } as never)
    const app = await getApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/challenges/7', headers: await headers() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, removedEntries: 2 })
    expect(dbMock.challenge.delete).toHaveBeenCalledWith({ where: { id: 7 } })
  })

  it('404s an unknown or malformed id', async () => {
    dbMock.challenge.findUnique.mockResolvedValue(null)
    const app = await getApp()
    expect((await app.inject({ method: 'DELETE', url: '/api/challenges/99', headers: await headers() })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: '/api/challenges/abc', headers: await headers() })).statusCode).toBe(404)
    expect(dbMock.challenge.delete).not.toHaveBeenCalled()
  })

  it('is owner only', async () => {
    dbMock.user.findUnique.mockResolvedValue({ role: 'user' } as never)
    const app = await getApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/challenges/7', headers: await headers() })
    expect(res.statusCode).toBe(403)
    expect(dbMock.challenge.delete).not.toHaveBeenCalled()
  })

  it('needs sign-in', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/challenges/7' })
    expect(res.statusCode).toBe(401)
  })
})

describe('CHALLENGE-DELETE · no double publish', () => {
  it('refuses the same title and start a second time', async () => {
    dbMock.challenge.findFirst.mockResolvedValue({ id: 7 } as never)
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/challenges', headers: await headers(), payload: body })
    expect(res.statusCode).toBe(409)
    expect(dbMock.challenge.create).not.toHaveBeenCalled()
  })

  it('still publishes a new one', async () => {
    dbMock.challenge.findFirst.mockResolvedValue(null)
    dbMock.challenge.create.mockResolvedValue({ id: 8, ...body } as never)
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/challenges', headers: await headers(), payload: body })
    expect(res.statusCode).toBe(201)
  })
})
