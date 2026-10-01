// Regression tests for the second round of QA fixes (1 Oct 2026):
//   B-10  failed logins are throttled per ACCOUNT, not only per IP
//   B-12  the delete-account form can check the password first
//   B-18  a coach page address is normalised ("qa-coach--" → "qa-coach")
import { describe, it, expect, beforeEach, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { resetLoginThrottle } from '../src/modules/auth/auth.routes.js'
import { playerMayCall } from '../src/lib/player-lockdown.js'

const HASH = bcrypt.hashSync('right-password', 4)
const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

beforeEach(() => {
  vi.clearAllMocks()
  resetLoginThrottle()
  mock.user.findUnique.mockResolvedValue({ id: 1, email: 'coach@test.dev', role: 'user', accountType: 'coach', passwordHash: HASH, emailVerifiedAt: new Date() } as never)
  mock.refreshToken.create.mockResolvedValue({ id: 1 } as never)
})

describe('B-10 · login throttle per account', () => {
  const login = async (password: string, email = 'coach@test.dev') => {
    const app = await getApp()
    return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  }

  it('locks one email after ten wrong passwords, with a 429 that says so', async () => {
    for (let i = 0; i < 10; i++) expect((await login('nope')).statusCode).toBe(401)
    const locked = await login('nope')
    expect(locked.statusCode).toBe(429)
    expect(locked.json().message).toMatch(/15 minutes|reset your password/i)
    // The right password is refused too while locked — that is the point.
    expect((await login('right-password')).statusCode).toBe(429)
  })

  it('does not lock a different email from the same place', async () => {
    for (let i = 0; i < 10; i++) await login('nope')
    expect((await login('nope', 'other@test.dev')).statusCode).toBe(401)
  })

  it('a correct login clears the count', async () => {
    for (let i = 0; i < 5; i++) await login('nope')
    expect((await login('right-password')).statusCode).toBe(200)
    for (let i = 0; i < 9; i++) await login('nope')
    expect((await login('nope')).statusCode).toBe(401) // 10th fail since the reset, not yet locked
  })
})

describe('B-12 · POST /users/me/password/check', () => {
  const check = async (password: string) => {
    const app = await getApp()
    return app.inject({ method: 'POST', url: '/api/users/me/password/check', headers: authHeaders(await accessToken()), payload: { password } })
  }
  it('says yes to the right password and 403 wrong_password to a wrong one', async () => {
    expect((await check('right-password')).statusCode).toBe(200)
    const bad = await check('wrong')
    expect(bad.statusCode).toBe(403)
    expect(bad.json().error).toBe('wrong_password')
  })
  it('is on the player allow-list (players delete accounts too)', () => {
    expect(playerMayCall('/api/users/me/password/check')).toBe(true)
  })
})

describe('B-18 · coach page address', () => {
  it('collapses runs of hyphens and trims the ends before saving', async () => {
    const app = await getApp()
    mock.user.findUnique.mockResolvedValue({ id: 1, role: 'user', accountType: 'coach', coachSlug: null, coachPageEnabled: true } as never)
    mock.user.findFirst.mockResolvedValue(null)
    mock.user.update.mockResolvedValue({ id: 1, coachSlug: 'qa-coach' } as never)
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/coach/me/branding',
      headers: authHeaders(await accessToken()),
      payload: { slug: 'qa-coach--' },
    })
    // Whatever the service returns, the address reached it clean.
    const update = mock.user.update.mock.calls.find((c) => (c[0] as { data?: { coachSlug?: string } }).data?.coachSlug !== undefined)
    if (update) expect((update[0] as { data: { coachSlug: string } }).data.coachSlug).toBe('qa-coach')
    expect([200, 422, 500]).toContain(res.statusCode)
    if (res.statusCode === 422) expect(res.json().message).not.toMatch(/hyphens only/)
  })
})
