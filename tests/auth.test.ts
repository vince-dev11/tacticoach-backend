import crypto from 'node:crypto'
import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import { dbMock } from './setup.js'
import { getApp, userRow } from './helpers.js'

const registerBody = {
  name: 'Test',
  surname: 'Coach',
  email: 'coach@test.dev',
  password: 'password123',
}

describe('POST /api/auth/register', () => {
  it('creates a user, starts a 7-day trial and returns tokens', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(null)
    dbMock.user.create.mockResolvedValue(userRow() as never)
    dbMock.membershipPlan.findUnique.mockResolvedValue({ id: 2, slug: 'pro-ai' } as never)
    dbMock.userSubscription.create.mockResolvedValue({} as never)
    dbMock.refreshToken.create.mockResolvedValue({} as never)

    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: registerBody })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.user.email).toBe('coach@test.dev')
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    // Trial subscription created against the pro-ai plan
    expect(dbMock.userSubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'trial', planId: 2 }),
      }),
    )
    const expiresAt = dbMock.userSubscription.create.mock.calls[0][0].data.expiresAt as Date
    const days = (expiresAt.getTime() - Date.now()) / 86400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThanOrEqual(7)
  })

  it('still registers when the trial plan is not seeded', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(null)
    dbMock.user.create.mockResolvedValue(userRow() as never)
    dbMock.membershipPlan.findUnique.mockResolvedValue(null)
    dbMock.refreshToken.create.mockResolvedValue({} as never)

    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: registerBody })
    expect(res.statusCode).toBe(201)
    expect(dbMock.userSubscription.create).not.toHaveBeenCalled()
  })

  it('rejects a duplicate email with 409', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(userRow() as never)

    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: registerBody })
    expect(res.statusCode).toBe(409)
  })

  it('rejects invalid input with 422', async () => {
    const app = await getApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...registerBody, email: 'not-an-email', password: 'short' },
    })
    expect(res.statusCode).toBe(422)
    const body = res.json()
    expect(body.issues).toHaveProperty('email')
    expect(body.issues).toHaveProperty('password')
  })
})

describe('POST /api/auth/login', () => {
  it('returns tokens for valid credentials', async () => {
    const app = await getApp()
    const passwordHash = await bcrypt.hash('password123', 4)
    dbMock.user.findUnique.mockResolvedValue(userRow({ passwordHash }) as never)
    dbMock.refreshToken.create.mockResolvedValue({} as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'coach@test.dev', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.accessToken).toBeTruthy()
    expect(body.user).not.toHaveProperty('passwordHash')
  })

  it('rejects a wrong password with 401', async () => {
    const app = await getApp()
    const passwordHash = await bcrypt.hash('password123', 4)
    dbMock.user.findUnique.mockResolvedValue(userRow({ passwordHash }) as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'coach@test.dev', password: 'wrong-password' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects an unknown email with 401 (no enumeration)', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@test.dev', password: 'password123' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/auth/refresh', () => {
  it('rotates a valid refresh token', async () => {
    const app = await getApp()
    const token = app.jwt.sign({ sub: 1, type: 'refresh' }, { expiresIn: '30d' })
    dbMock.refreshToken.findUnique.mockResolvedValue({
      id: 1,
      userId: 1,
      token,
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(),
      user: userRow(),
    } as never)
    dbMock.refreshToken.deleteMany.mockResolvedValue({ count: 1 } as never)
    dbMock.refreshToken.create.mockResolvedValue({} as never)

    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: token } })
    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeTruthy()
    // Old token revoked (stored/looked up as a sha256 hash — the raw token
    // never touches the DB), new one persisted.
    const hashed = crypto.createHash('sha256').update(token).digest('hex')
    expect(dbMock.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { token: hashed } })
    expect(dbMock.refreshToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: hashed } }),
    )
    expect(dbMock.refreshToken.create).toHaveBeenCalled()
  })

  it('rejects an ACCESS token used as a refresh token (type check)', async () => {
    const app = await getApp()
    const accessOnly = app.jwt.sign({ sub: 1, email: 'v@t.dev' }, { expiresIn: '15m' })
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: accessOnly } })
    expect(res.statusCode).toBe(401)
    // Never even reaches the DB.
    expect(dbMock.refreshToken.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a token missing from the DB (revoked) with 401', async () => {
    const app = await getApp()
    const token = app.jwt.sign({ sub: 1, type: 'refresh' }, { expiresIn: '30d' })
    dbMock.refreshToken.findUnique.mockResolvedValue(null)

    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: token } })
    expect(res.statusCode).toBe(401)
  })

  it('rejects garbage tokens with 401', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: 'garbage' } })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/auth/forgot-password', () => {
  it('returns the same generic 200 whether or not the email exists', async () => {
    const app = await getApp()

    dbMock.user.findUnique.mockResolvedValue(null)
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'nobody@test.dev' },
    })

    dbMock.user.findUnique.mockResolvedValue(userRow() as never)
    dbMock.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 } as never)
    dbMock.passwordResetToken.create.mockResolvedValue({} as never)
    const known = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'coach@test.dev' },
    })

    expect(unknown.statusCode).toBe(200)
    expect(known.statusCode).toBe(200)
    expect(unknown.json()).toEqual(known.json())
  })
})

describe('POST /api/auth/reset-password', () => {
  it('rejects an invalid or expired token with 400', async () => {
    const app = await getApp()
    dbMock.passwordResetToken.findUnique.mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: 'bad-token', password: 'newpassword1' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('sets the new password and revokes sessions on success', async () => {
    const app = await getApp()
    dbMock.passwordResetToken.findUnique.mockResolvedValue({
      id: 5,
      userId: 1,
      tokenHash: 'x',
      expiresAt: new Date(Date.now() + 3600_000),
      usedAt: null,
      createdAt: new Date(),
    } as never)
    dbMock.$transaction.mockResolvedValue([] as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: 'good-token', password: 'newpassword1' },
    })
    expect(res.statusCode).toBe(200)
    expect(dbMock.$transaction).toHaveBeenCalled()
  })
})
