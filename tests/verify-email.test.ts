// Email verification — stateless JWT links.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, userRow } from './helpers.js'
import { isMailConfigured, sendMail } from '../src/config/mailer.js'

const mailConfigured = vi.mocked(isMailConfigured)
const sendMailMock = vi.mocked(sendMail)

beforeEach(() => {
  mailConfigured.mockReturnValue(true)
  sendMailMock.mockReset()
  sendMailMock.mockResolvedValue(undefined)
})

afterEach(() => {
  mailConfigured.mockReturnValue(false)
})

async function verifyToken(userId = 1) {
  const app = await getApp()
  return app.jwt.sign({ sub: userId, email: 'coach@test.dev', type: 'verify-email' }, { expiresIn: '24h' })
}

describe('welcome email verification link', () => {
  it('includes a /verify-email link in the welcome email', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(null)
    dbMock.user.create.mockResolvedValue(userRow() as never)
    dbMock.membershipPlan.findUnique.mockResolvedValue(null)
    dbMock.refreshToken.create.mockResolvedValue({} as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Test', surname: 'Coach', email: 'coach@test.dev', password: 'password123' },
    })
    expect(res.statusCode).toBe(201)
    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalled())
    expect(sendMailMock.mock.calls[0][0].html).toContain('/verify-email?token=')
  })
})

describe('POST /api/auth/verify-email', () => {
  it('marks the email verified with a valid token', async () => {
    const app = await getApp()
    dbMock.user.updateMany.mockResolvedValue({ count: 1 } as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: await verifyToken() },
    })
    expect(res.statusCode).toBe(200)
    expect(dbMock.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1, emailVerifiedAt: null },
        data: { emailVerifiedAt: expect.any(Date) },
      }),
    )
  })

  it('rejects garbage tokens with 400', async () => {
    const app = await getApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: 'garbage' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects tokens of the wrong type (e.g. a refresh token)', async () => {
    const app = await getApp()
    const refresh = app.jwt.sign({ sub: 1, type: 'refresh' }, { expiresIn: '30d' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: refresh },
    })
    expect(res.statusCode).toBe(400)
    expect(dbMock.user.updateMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/resend-verification', () => {
  it('requires auth', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/auth/resend-verification' })
    expect(res.statusCode).toBe(401)
  })

  it('sends a fresh verification email for unverified users', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(userRow({ emailVerifiedAt: null }) as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/resend-verification',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1))
    expect(sendMailMock.mock.calls[0][0].subject).toMatch(/verify/i)
  })

  it('does not resend when already verified', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(userRow({ emailVerifiedAt: new Date() }) as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/resend-verification',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().message).toMatch(/already verified/i)
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})
