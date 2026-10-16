// VERIFY-GATE (16 Oct 2026, owner): nobody uses TactiCoach until their email is
// verified. Older accounts get 7 days' grace from the gate's start; new ones
// are gated at once. A gated account can look around (GET) but every write is
// refused with 403 EMAIL_UNVERIFIED — except its own account and getting
// verified. The owner is never gated.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { verificationState, graceEndsAt, allowedWhileUnverified, gateFrom, VERIFY_GRACE_DAYS, forgetGate, gateSwitch } from '../src/lib/email-verify-gate.js'

const DAY = 86_400_000
const from = gateFrom()

beforeEach(() => { vi.clearAllMocks(); forgetGate(1); gateSwitch.on = true })
afterEach(() => { gateSwitch.on = false })

describe('VERIFY-GATE · who is gated, and when', () => {
  it('verified, and the owner, are never gated', () => {
    expect(verificationState({ emailVerifiedAt: new Date(), createdAt: new Date() }).required).toBe(false)
    expect(verificationState({ emailVerifiedAt: null, createdAt: new Date(), role: 'owner' }).required).toBe(false)
  })
  it('an account made before the gate has 7 days of grace, then is gated', () => {
    const old = { emailVerifiedAt: null, createdAt: new Date(from.getTime() - 30 * DAY) }
    expect(graceEndsAt(old).getTime()).toBe(from.getTime() + VERIFY_GRACE_DAYS * DAY)
    const during = verificationState(old, new Date(from.getTime() + 2 * DAY))
    expect(during.required).toBe(false)
    expect(during.graceEndsAt).toBe(new Date(from.getTime() + 7 * DAY).toISOString())
    expect(verificationState(old, new Date(from.getTime() + 8 * DAY)).required).toBe(true)
  })
  it('with the gate off (EMAIL_VERIFY_GATE=off locally) nobody is gated', () => {
    gateSwitch.on = false
    expect(verificationState({ emailVerifiedAt: null, createdAt: new Date(gateFrom().getTime() + DAY) }, new Date(gateFrom().getTime() + 30 * DAY)).required).toBe(false)
  })
  it('an account made after the gate started is gated at once', () => {
    const fresh = { emailVerifiedAt: null, createdAt: new Date(from.getTime() + DAY) }
    expect(verificationState(fresh, new Date(from.getTime() + DAY + 1000)).required).toBe(true)
  })
  it('looking around, verifying, the account itself and logging out are always allowed', () => {
    expect(allowedWhileUnverified('GET', '/api/canvas/boards')).toBe(true)
    for (const url of ['/api/auth/resend-verification', '/api/auth/logout', '/api/users/me', '/api/users/me/password', '/api/family/invite/abc']) expect(allowedWhileUnverified('POST', url), url).toBe(true)
    expect(allowedWhileUnverified('DELETE', '/api/users/me')).toBe(true)
    expect(allowedWhileUnverified('POST', '/api/canvas/boards')).toBe(false)
    expect(allowedWhileUnverified('POST', '/api/feedback')).toBe(false)
  })
})

describe('VERIFY-GATE · the API refuses a gated write', () => {
  it('POST a board unverified (new account) → 403 EMAIL_UNVERIFIED; /users/me says required', async () => {
    const mock = dbMock as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }
    mock.user.findUnique.mockResolvedValue({ id: 1, emailVerifiedAt: null, createdAt: new Date(), role: 'user', accountType: 'coach', dateOfBirth: null } as never)
    const app = await getApp()
    const headers = authHeaders(await accessToken())
    const res = await app.inject({ method: 'POST', url: '/api/canvas/boards', headers, payload: { title: 'x' } })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('EMAIL_UNVERIFIED')
    const me = await app.inject({ method: 'GET', url: '/api/users/me', headers })
    expect(me.statusCode).toBe(200)
    expect(me.json().emailVerification).toMatchObject({ verified: false, required: true })
  })
  it('a verified account writes as before', async () => {
    const mock = dbMock as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }
    mock.user.findUnique.mockResolvedValue({ id: 1, emailVerifiedAt: new Date(), createdAt: new Date(), role: 'user', accountType: 'coach' } as never)
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/canvas/boards', headers: authHeaders(await accessToken()), payload: { title: 'x' } })
    expect(res.json().code).not.toBe('EMAIL_UNVERIFIED')
  })
})
