import crypto from 'node:crypto'
import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import { dbMock } from './setup.js'
import { getApp, userRow, mockUserFindUnique } from './helpers.js'

const yearsAgo = (y: number) => `${new Date().getUTCFullYear() - y}-01-01`

const registerBody = {
  name: 'Test',
  surname: 'Coach',
  email: 'coach@test.dev',
  password: 'password123',
}

describe('POST /api/auth/register', () => {
  it('FT-4 · creates a coach on the 14-day free trial — no subscription row — and returns tokens', async () => {
    const app = await getApp()
    mockUserFindUnique(dbMock.user.findUnique, userRow(), { whenNoSelect: null })
    dbMock.user.create.mockResolvedValue(userRow() as never)
    dbMock.refreshToken.create.mockResolvedValue({} as never)

    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: registerBody })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.user.email).toBe('coach@test.dev')
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    // The free plan is the trial: held on the user, never a Pro trial row.
    expect(dbMock.userSubscription.create).not.toHaveBeenCalled()
    const endsAt = (dbMock.user.create.mock.calls[0][0] as { data: { freeTrialEndsAt: Date } }).data.freeTrialEndsAt
    const days = (endsAt.getTime() - Date.now()) / 86400_000
    expect(days).toBeGreaterThan(13.9)
    expect(days).toBeLessThanOrEqual(14)
  })

  // FAMILY-SIGNUP (12 Oct 2026): players sign up with a date of birth and a tick.
  it('FAMILY-SIGNUP · a player needs a date of birth and the age tick', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...registerBody, accountType: 'player' } })
    expect(res.statusCode).toBe(422)
    expect(Object.keys(res.json().issues)).toEqual(['dateOfBirth', 'confirmAge'])
    expect(dbMock.user.create).not.toHaveBeenCalled()
  })

  it('FAMILY-SIGNUP · under 13: no account — a parent signs up instead', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...registerBody, accountType: 'player', dateOfBirth: yearsAgo(11), confirmAge: true } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('under_13')
    expect(dbMock.user.create).not.toHaveBeenCalled()
  })

  it('FAMILY-SIGNUP · 13–17: needs a parent; the account is made, the parent asked, and no tokens', async () => {
    const app = await getApp()
    const teen = { ...registerBody, email: 'teen@test.dev', accountType: 'player', dateOfBirth: yearsAgo(15), confirmAge: true }
    const noParent = await app.inject({ method: 'POST', url: '/api/auth/register', payload: teen })
    expect(noParent.statusCode).toBe(422)
    expect(noParent.json().issues.parent).toBeTruthy()
    const same = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...teen, parent: { name: 'P', email: 'teen@test.dev' } } })
    expect(same.statusCode).toBe(422)

    dbMock.user.findUnique.mockResolvedValue(null as never)
    dbMock.user.create.mockImplementation((async ({ data }: { data: { email: string; name: string; accountType: string } }) => ({ id: data.accountType === 'parent' ? 70 : 61, name: data.name, surname: 'S', email: data.email, accountType: data.accountType })) as never)
    dbMock.parentLink.findUnique.mockResolvedValue(null as never)
    dbMock.parentLink.create.mockResolvedValue({} as never)
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...teen, parent: { name: 'Pat', email: 'pat@test.dev' } } })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ awaitingParent: true, parentEmail: 'pat@test.dev' })
    const child = dbMock.user.create.mock.calls.find((c) => (c[0] as { data: { accountType: string } }).data.accountType === 'player')![0] as { data: { dateOfBirth: Date; freeTrialEndsAt: null } }
    expect(child.data.dateOfBirth).toEqual(new Date(`${yearsAgo(15)}T00:00:00Z`))
    expect(child.data.freeTrialEndsAt).toBeNull()
    expect(dbMock.parentLink.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ parentUserId: 70, childUserId: 61, status: 'pending', invitedById: null }) }))
    expect(dbMock.refreshToken.create).not.toHaveBeenCalled()
  })

  it('FAMILY-SIGNUP · a parent signs up like anyone else, with no trial', async () => {
    const app = await getApp()
    mockUserFindUnique(dbMock.user.findUnique, userRow({ accountType: 'parent' }), { whenNoSelect: null })
    dbMock.user.create.mockResolvedValue(userRow({ accountType: 'parent' }) as never)
    dbMock.refreshToken.create.mockResolvedValue({} as never)
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...registerBody, accountType: 'parent' } })
    expect(res.statusCode).toBe(201)
    expect(res.json().accessToken).toBeTruthy()
    expect((dbMock.user.create.mock.calls[0][0] as { data: { freeTrialEndsAt: null } }).data.freeTrialEndsAt).toBeNull()
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
    // Credential check reads the whole row; the response is built from a
    // SELECTed read, which is why the hash must not appear below.
    mockUserFindUnique(dbMock.user.findUnique, userRow({ passwordHash, role: 'owner' }))
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
    // The whole point of the shared shape: `role` decides whether the Admin
    // link renders, and login used to omit it, so an owner logging in saw no
    // Admin link until they reloaded the page.
    expect(body.user.role).toBe('owner')
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
    // Refresh tokens carry their own signing key (see app.ts) — mint through
    // the refresh namespace, exactly as the login/register routes do.
    const token = app.jwt.refresh.sign({ sub: 1, type: 'refresh' }, { expiresIn: '30d' })
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
    // Refresh tokens carry their own signing key (see app.ts) — mint through
    // the refresh namespace, exactly as the login/register routes do.
    const token = app.jwt.refresh.sign({ sub: 1, type: 'refresh' }, { expiresIn: '30d' })
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
