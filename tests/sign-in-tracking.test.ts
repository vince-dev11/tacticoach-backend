// SIGN-IN (23 Oct 2026) · has this person ever signed in, and did an invited
// person set their password from their link? Recorded on the user, shown and
// filtered in Admin → Users.

import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import { dbMock } from './setup.js'
import { getApp, userRow, mockUserFindUnique, accessToken, authHeaders } from './helpers.js'
import { UserFilters, userWhere } from '../src/modules/admin/user-filters.js'

type Call = [{ where: Record<string, unknown>; data: Record<string, unknown> }]
const updates = () => (dbMock.user.update.mock.calls as unknown as Call[]).map((c) => c[0])
const updateManys = () => (dbMock.user.updateMany.mock.calls as unknown as Call[]).map((c) => c[0])

describe('SIGN-IN-1 · a sign-in is recorded', () => {
  it('login sets last sign-in, and first sign-in only when it is empty', async () => {
    const app = await getApp()
    const passwordHash = await bcrypt.hash('password123', 4)
    mockUserFindUnique(dbMock.user.findUnique, userRow({ passwordHash }))
    dbMock.refreshToken.create.mockResolvedValue({} as never)
    dbMock.$transaction.mockResolvedValue([] as never)

    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'coach@test.dev', password: 'password123' } })
    expect(res.statusCode).toBe(200)
    expect(updates().some((u) => u.data.lastLoginAt instanceof Date)).toBe(true)
    const first = updateManys().find((u) => 'firstLoginAt' in u.data)!
    expect(first.where).toMatchObject({ firstLoginAt: null })
  })

  it('a wrong password records nothing', async () => {
    const app = await getApp()
    const passwordHash = await bcrypt.hash('password123', 4)
    dbMock.user.findUnique.mockResolvedValue(userRow({ passwordHash }) as never)
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'coach@test.dev', password: 'nope-nope' } })
    expect(updates().some((u) => 'lastLoginAt' in u.data)).toBe(false)
  })

  it('a token refresh is not a sign-in', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: 'x' } })
    expect(res.statusCode).toBe(401)
    expect(updates().some((u) => 'lastLoginAt' in u.data)).toBe(false)
  })
})

describe('SIGN-IN-2 · an invited person setting their password from the link', () => {
  it('marks the invitation done — only for an invited account, only the first time', async () => {
    const app = await getApp()
    dbMock.passwordResetToken.findUnique.mockResolvedValue({
      id: 5, userId: 1, tokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000), usedAt: null, createdAt: new Date(),
    } as never)
    dbMock.user.findUnique.mockResolvedValue({ emailVerifiedAt: null, setupInvitedAt: new Date(), setupCompletedAt: null } as never)
    dbMock.$transaction.mockResolvedValue([] as never)

    const res = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: 'good-token', password: 'newpassword1' } })
    expect(res.statusCode).toBe(200)
    const done = updateManys().find((u) => 'setupCompletedAt' in u.data)!
    expect(done.where).toMatchObject({ id: 1, setupInvitedAt: { not: null }, setupCompletedAt: null })
    expect(done.data.setupCompletedAt).toBeInstanceOf(Date)
  })
})

describe('SIGN-IN-3 · Admin → Users shows it and filters by it', () => {
  it('the list sends first/last sign-in and invitation done', async () => {
    const app = await getApp()
    dbMock.user.findUnique.mockResolvedValue({ role: 'owner', accountType: 'coach' } as never)
    dbMock.user.findMany.mockResolvedValue([] as never)
    dbMock.user.count.mockResolvedValue(0 as never)
    await app.inject({ method: 'GET', url: '/api/admin/users', headers: authHeaders(await accessToken()) })
    const call = dbMock.user.findMany.mock.calls.find((c) => (c[0] as { select?: Record<string, unknown> })?.select?.lastLoginAt)
    expect(call, 'a findMany selecting the sign-in fields').toBeTruthy()
    const select = (call![0] as { select: Record<string, unknown> }).select
    expect(select).toMatchObject({ firstLoginAt: true, lastLoginAt: true, setupCompletedAt: true })
    // E2E 23 Oct 2026: an under-13 shows "no login", not "never signed in".
    expect(select).toMatchObject({ canLogin: true })
  })

  it('filters: signed in yes/no, invitation done/waiting', () => {
    const w = (f: Record<string, string>) => JSON.stringify(userWhere(UserFilters.parse(f)))
    expect(w({ signedIn: 'yes' })).toContain('"firstLoginAt":{"not":null}')
    expect(w({ signedIn: 'no' })).toContain('"firstLoginAt":null')
    expect(w({ invite: 'done' })).toContain('"setupCompletedAt":{"not":null}')
    expect(w({ invite: 'waiting' })).toContain('"setupInvitedAt":{"not":null},"setupCompletedAt":null')
    expect(userWhere(UserFilters.parse({ signedIn: 'maybe', invite: 'x' }))).toEqual({})
  })
})
