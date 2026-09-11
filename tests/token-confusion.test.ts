// Only an ACCESS token may authorise a request.
//
// Every token the API mints used to be signed by the same instance, so a
// refresh token (30 days) or an email-verification token (24h, and it travels
// in a URL — inbox, browser history, referrer headers, logs) passed
// jwtVerify() and authenticated as that user. These tests pin the two halves
// of the fix: refresh tokens are signed with a separate secret, and authGuard
// rejects anything carrying a non-access `type` claim.

import { describe, it, expect } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, userRow } from './helpers.js'

const ME = '/api/users/me'

describe('token confusion', () => {
  it('accepts a genuine access token (control)', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(userRow() as never)
    const res = await app.inject({ method: 'GET', url: ME, headers: authHeaders(await accessToken()) })
    expect(res.statusCode).toBe(200)
  })

  it('rejects an email-verification token used as a bearer token', async () => {
    const app = await getApp()
    // Same shape the verification link carries: signed by the API, has sub+email.
    const verifyToken = app.jwt.sign(
      { sub: 1, email: 'coach@test.dev', type: 'verify-email' },
      { expiresIn: '24h' },
    )
    const res = await app.inject({ method: 'GET', url: ME, headers: authHeaders(verifyToken) })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a refresh token used as a bearer token', async () => {
    const app = await getApp()
    const refresh = app.jwt.refresh.sign({ sub: 1, type: 'refresh' }, { expiresIn: '30d' })
    const res = await app.inject({ method: 'GET', url: ME, headers: authHeaders(refresh) })
    expect(res.statusCode).toBe(401)
  })

  it('signs refresh tokens with a different key than access tokens', async () => {
    const app = await getApp()
    const refresh = app.jwt.refresh.sign({ sub: 1, type: 'refresh' }, { expiresIn: '30d' })
    // The access-token verifier must NOT accept a refresh token's signature.
    expect(() => app.jwt.verify(refresh)).toThrow()
    const access = app.jwt.sign({ sub: 1, email: 'coach@test.dev' }, { expiresIn: '15m' })
    expect(() => app.jwt.refresh.verify(access)).toThrow()
  })

  it('will not refresh using an access token', async () => {
    const app = await getApp()
    const access = app.jwt.sign({ sub: 1, email: 'coach@test.dev' }, { expiresIn: '15m' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: access },
    })
    expect(res.statusCode).toBe(401)
  })
})
