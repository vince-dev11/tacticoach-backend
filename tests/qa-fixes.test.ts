// Regression tests for the 30 Sep QA run's must-fix bugs (API side).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, userRow, mockUserFindUnique } from './helpers.js'
import { playerMayCall } from '../src/lib/player-lockdown.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const HASH = bcrypt.hashSync('right-password', 4)

const register = async (payload: Record<string, unknown>) => {
  const app = await getApp()
  return app.inject({ method: 'POST', url: '/api/auth/register', payload })
}
const base = { name: 'QA', surname: 'Coach', email: 'qa@test.dev', password: 'Passw0rd!' }

beforeEach(() => {
  vi.clearAllMocks()
  mockUserFindUnique(dbMock.user.findUnique, userRow(), { whenNoSelect: null })
  dbMock.user.create.mockResolvedValue(userRow() as never)
  dbMock.membershipPlan.findUnique.mockResolvedValue(null as never)
  dbMock.refreshToken.create.mockResolvedValue({} as never)
})

describe('B-01 · register checks password_confirmation', () => {
  it('refuses a mismatch with a field message', async () => {
    const res = await register({ ...base, password_confirmation: 'Different1!' })
    expect(res.statusCode).toBe(422)
    expect(JSON.stringify(res.json())).toContain('Passwords do not match')
    expect(dbMock.user.create).not.toHaveBeenCalled()
  })
  it('accepts a match, and a request with no confirmation (API clients)', async () => {
    expect((await register({ ...base, password_confirmation: 'Passw0rd!' })).statusCode).toBe(201)
    expect((await register(base)).statusCode).toBe(201)
  })
})

describe('B-05 · a name of spaces is refused', () => {
  it('422', async () => {
    expect((await register({ ...base, name: '   ' })).statusCode).toBe(422)
  })
})

describe('B-09 · refresh tokens are unique even in the same second', () => {
  it('two logins in a row store two different token hashes', async () => {
    mockUserFindUnique(dbMock.user.findUnique, userRow({ passwordHash: bcrypt.hashSync('Passw0rd!', 4) }))
    const app = await getApp()
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'qa@test.dev', password: 'Passw0rd!' } })
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'qa@test.dev', password: 'Passw0rd!' } })
    const hashes = dbMock.refreshToken.create.mock.calls.map((c) => (c[0] as { data: { token: string } }).data.token)
    expect(hashes).toHaveLength(2)
    expect(hashes[0]).not.toBe(hashes[1])
  })
})

describe('B-17 · change password from the profile', () => {
  const call = async (payload: unknown) => {
    const app = await getApp()
    return app.inject({ method: 'POST', url: '/api/users/me/password', headers: authHeaders(await accessToken()), payload: payload as never })
  }
  beforeEach(() => {
    dbMock.user.findUnique.mockImplementation((args?: unknown) => {
      const keys = Object.keys((args as { select?: Record<string, unknown> } | undefined)?.select ?? {})
      if (keys.length && keys.every((k) => k === 'role' || k === 'accountType')) return Promise.resolve({ role: 'user', accountType: 'coach' } as never)
      return Promise.resolve({ id: 1, passwordHash: HASH } as never)
    })
    dbMock.$transaction.mockResolvedValue([] as never)
  })

  it('needs the current password', async () => {
    const res = await call({ current: 'wrong', next: 'NewPassw0rd!' })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('wrong_password')
  })
  it('refuses a short new password and the same password', async () => {
    expect((await call({ current: 'right-password', next: 'short' })).statusCode).toBe(422)
    expect((await call({ current: 'right-password', next: 'right-password' })).json().error).toBe('same_password')
  })
  it('changes it and signs other sessions out', async () => {
    const res = await call({ current: 'right-password', next: 'NewPassw0rd!' })
    expect(res.statusCode).toBe(200)
    expect(dbMock.$transaction).toHaveBeenCalled()
  })
  it('is on the player allow-list', () => {
    expect(playerMayCall('/api/users/me/password')).toBe(true)
    expect(playerMayCall('/api/users/me/guardian')).toBe(true)
  })
})

describe('B-15 · a player sets a parent or guardian email', () => {
  const put = async (payload: unknown) => {
    const app = await getApp()
    return app.inject({ method: 'PUT', url: '/api/users/me/guardian', headers: authHeaders(await accessToken()), payload: payload as never })
  }
  beforeEach(() => {
    dbMock.user.findUnique.mockImplementation((args?: unknown) => {
      const keys = Object.keys((args as { select?: Record<string, unknown> } | undefined)?.select ?? {})
      if (keys.length && keys.every((k) => k === 'role' || k === 'accountType')) return Promise.resolve({ role: 'user', accountType: 'player' } as never)
      return Promise.resolve({ id: 1, accountType: 'player' } as never)
    })
  })

  it('writes it to every squad the player is linked to, lower-cased', async () => {
    mock.squadPlayer.updateMany.mockResolvedValue({ count: 2 })
    const res = await put({ email: 'Mum@Example.com' })
    expect(res.statusCode).toBe(200)
    expect(mock.squadPlayer.updateMany.mock.calls[0][0]).toMatchObject({
      where: { playerUserId: 1, linkStatus: { in: ['active', 'pending'] } },
      data: { guardianEmail: 'mum@example.com' },
    })
  })
  it('can be cleared', async () => {
    mock.squadPlayer.updateMany.mockResolvedValue({ count: 1 })
    expect((await put({ email: null })).json().email).toBeNull()
  })
  it('explains when no coach has linked them yet', async () => {
    mock.squadPlayer.updateMany.mockResolvedValue({ count: 0 })
    const res = await put({ email: 'mum@example.com' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('not_linked')
  })
  it('reads back from the first linked squad', async () => {
    mock.squadPlayer.findFirst.mockResolvedValue({ guardianEmail: 'dad@example.com' })
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/users/me/guardian', headers: authHeaders(await accessToken()) })
    expect(res.json()).toEqual({ email: 'dad@example.com', linked: true })
  })
})
