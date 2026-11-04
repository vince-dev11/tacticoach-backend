// BULK-MAIL (owner, 4 Nov 2026): Admin → Users → "Email everyone" — one
// message to coaches and clubs as individual emails, three audiences
// (all / signed in / set up password), a one-click opt-out on every copy,
// players and parents never included, owner-only.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { isMailConfigured, sendMail } from '../src/config/mailer.js'
import { audienceWhere, optOutUrl, optOutTokenOk, personalise, BULK_GAP_MS } from '../src/lib/team-updates.js'

const mailConfigured = vi.mocked(isMailConfigured)
const sendMailMock = vi.mocked(sendMail)
const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

function asOwner() {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const keys = Object.keys((args as { select?: Record<string, unknown> } | undefined)?.select ?? {})
    if (keys.length && keys.every((k) => k === 'role' || k === 'accountType')) return Promise.resolve({ role: 'owner', accountType: 'coach' } as never)
    return Promise.resolve(null as never)
  })
}
const h = async () => authHeaders(await accessToken())

beforeEach(() => {
  vi.clearAllMocks()
  mailConfigured.mockReturnValue(true)
  sendMailMock.mockReset()
  sendMailMock.mockResolvedValue(undefined)
  asOwner()
})

describe('BULK-MAIL · who it can reach', () => {
  it('coaches and clubs with a login and an address, never opted out — then the audience filter', () => {
    const base = audienceWhere('all') as { AND: Record<string, unknown>[] }
    expect(base.AND[0]).toEqual({ accountType: { in: ['coach', 'club'] }, canLogin: true, email: { contains: '@' }, teamUpdatesOptOutAt: null })
    expect(base.AND[1]).toEqual({})
    expect((audienceWhere('signed_in') as { AND: unknown[] }).AND[1]).toEqual({ firstLoginAt: { not: null } })
    expect((audienceWhere('set_up') as { AND: unknown[] }).AND[1]).toEqual({ setupCompletedAt: { not: null } })
  })

  it('{name} becomes the first name; a blank name reads "coach"', () => {
    expect(personalise('Hi {name}, {name}!', 'Priya')).toBe('Hi Priya, Priya!')
    expect(personalise('Hi {name}', '  ')).toBe('Hi coach')
  })

  it('the opt-out link is signed per user and does not transfer', () => {
    const url = new URL(optOutUrl(42))
    expect(url.pathname).toBe('/api/account/team-updates/opt-out')
    const t = url.searchParams.get('t')!
    expect(optOutTokenOk(42, t)).toBe(true)
    expect(optOutTokenOk(43, t)).toBe(false)
    expect(optOutTokenOk(42, t.slice(0, -1) + 'x')).toBe(false)
    expect(optOutTokenOk(42, '')).toBe(false)
  })
})

describe('BULK-MAIL · the routes', () => {
  it('count: how many would get it, for the admin to see before sending', async () => {
    mock.user.count.mockResolvedValueOnce(17 as never).mockResolvedValueOnce(2 as never)
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/users/bulk-message/count?audience=signed_in', headers: await h() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ audience: 'signed_in', count: 17, optedOut: 2 })
    const bad = await app.inject({ method: 'GET', url: '/api/admin/users/bulk-message/count?audience=players', headers: await h() })
    expect(bad.statusCode).toBe(422)
  })

  it('send: one email per person, first name filled in, opt-out in every copy, counts back', async () => {
    mock.user.findMany.mockResolvedValue([
      { id: 1, name: 'Priya', email: 'priya@test.dev' },
      { id: 2, name: 'Tom', email: 'tom@test.dev' },
      { id: 3, name: 'Bad', email: 'bad@test.dev' },
    ] as never)
    sendMailMock.mockImplementation(async (opts: { to: string }) => { if (opts.to === 'bad@test.dev') throw new Error('bounce') })
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: BULK_GAP_MS })
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/admin/users/bulk-message', headers: await h(), payload: { audience: 'all', subject: 'News for {name}', body: 'Hi {name},\n\nThe 3D board is here.' } })
    vi.useRealTimers()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ audience: 'all', recipients: 3, sent: 2, failed: 1, skipped: 0, truncated: false })
    expect(sendMailMock).toHaveBeenCalledTimes(3)
    const first = sendMailMock.mock.calls[0][0]
    expect(first).toMatchObject({ to: 'priya@test.dev', subject: 'News for Priya', kind: 'team_update', userId: 1 })
    expect(first.text).toContain('Hi Priya,')
    expect(first.text).toContain(`/api/account/team-updates/opt-out?u=1&t=`)
    expect(first.html).toContain('Opt out')
    expect(sendMailMock.mock.calls[1][0].text).toContain('Hi Tom,')
    expect(sendMailMock.mock.calls[1][0].text).toContain('opt-out?u=2&t=')
  })

  it('send: refused when email is not configured, so nothing is half-sent', async () => {
    mailConfigured.mockReturnValue(false)
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/admin/users/bulk-message', headers: await h(), payload: { audience: 'all', subject: 'Hello', body: 'Testing one two' } })
    expect(res.statusCode).toBe(503)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('a coach (not the owner) gets 403 on both', async () => {
    dbMock.user.findUnique.mockResolvedValue({ role: 'user', accountType: 'coach' } as never)
    const app = await getApp()
    expect((await app.inject({ method: 'GET', url: '/api/admin/users/bulk-message/count?audience=all', headers: await h() })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/admin/users/bulk-message', headers: await h(), payload: { audience: 'all', subject: 'Hello', body: 'Testing one two' } })).statusCode).toBe(403)
  })
})

describe('BULK-MAIL · the opt-out link, signed out', () => {
  it('a good link records the opt-out once and says so in plain words', async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: 42, teamUpdatesOptOutAt: null } as never)
    mock.user.update.mockResolvedValue({} as never)
    const app = await getApp()
    const url = new URL(optOutUrl(42))
    const res = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('You won’t get team updates any more')
    expect(mock.user.update).toHaveBeenCalledWith({ where: { id: 42 }, data: { teamUpdatesOptOutAt: expect.any(Date) } })
    // A second click changes nothing.
    dbMock.user.findUnique.mockResolvedValue({ id: 42, teamUpdatesOptOutAt: new Date() } as never)
    await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` })
    expect(mock.user.update).toHaveBeenCalledTimes(1)
  })

  it('a forged or broken link does nothing', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/account/team-updates/opt-out?u=42&t=nope' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('doesn’t work')
    expect(mock.user.update).not.toHaveBeenCalled()
  })
})
