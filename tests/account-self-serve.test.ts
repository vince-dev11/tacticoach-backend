// Self-serve account changes that used to need an email to us.
//
//   become-coach: a player account switched to a coach account, with the
//     same fresh trial a coach signup gets — but never an account a coach has
//     linked to their squad (possibly a child's, with a guardian copied in).
//   delete: password first; refused while it would keep charging a card,
//     pull a club out from under its coaches, or take books from readers.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { playerMayCall } from '../src/lib/player-lockdown.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const HASH = bcrypt.hashSync('right-password', 4)

function account(over: Record<string, unknown> = {}) {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const select = (args as { select?: Record<string, unknown> } | undefined)?.select
    const keys = select ? Object.keys(select) : []
    if (keys.length > 0 && keys.every((k) => k === 'role' || k === 'accountType')) {
      return Promise.resolve({ role: 'user', accountType: (over.accountType as string) ?? 'player' } as never)
    }
    return Promise.resolve({ id: 1, role: 'user', accountType: 'player', passwordHash: HASH, ...over } as never)
  })
}

async function call(method: 'POST' | 'DELETE', url: string, payload?: unknown) {
  const app = await getApp()
  return app.inject({ method, url, headers: authHeaders(await accessToken()), payload: payload as never })
}

beforeEach(() => {
  vi.clearAllMocks()
  account()
  mock.squadPlayer.count.mockResolvedValue(0)
  mock.membershipPlan.findUnique.mockResolvedValue({ id: 9 })
  mock.userSubscription.findUnique.mockResolvedValue(null)
  mock.club.findUnique.mockResolvedValue(null)
  mock.ebook.count.mockResolvedValue(0)
  dbMock.$transaction.mockImplementation(async (fn: unknown) => (fn as () => Promise<unknown>)() as never)
})

describe('I signed up as a player by mistake', () => {
  it('a player may call it (it is on the player allow-list)', () => {
    expect(playerMayCall('/api/users/me/become-coach')).toBe(true)
  })

  it('FT-4 · switches the account to coach and starts the same 14-day free trial a coach signup gets', async () => {
    const res = await call('POST', '/api/users/me/become-coach')
    expect(res.statusCode).toBe(200)
    const update = mock.user.update.mock.calls[0][0]
    expect(update).toMatchObject({ where: { id: 1 }, data: { accountType: 'coach' } })
    const days = (update.data.freeTrialEndsAt.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(13.9)
    expect(days).toBeLessThan(14.1)
    // No subscription row: the free plan is the trial.
    expect(mock.userSubscription.create).not.toHaveBeenCalled()
  })

  it('refuses an account a coach has linked to their squad', async () => {
    mock.squadPlayer.count.mockResolvedValue(1)
    const res = await call('POST', '/api/users/me/become-coach')
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('linked_player')
    expect(mock.user.update).not.toHaveBeenCalled()
  })

  it('refuses an account that is already a coach', async () => {
    account({ accountType: 'coach' })
    const res = await call('POST', '/api/users/me/become-coach')
    expect(res.statusCode).toBe(409)
  })
})

describe('delete my account', () => {
  it('needs the right password', async () => {
    const res = await call('DELETE', '/api/users/me', { password: 'wrong' })
    expect(res.statusCode).toBe(403)
    expect(mock.user.delete).not.toHaveBeenCalled()
  })

  it('deletes the account, and its unpublished drafts first', async () => {
    const res = await call('DELETE', '/api/users/me', { password: 'right-password' })
    expect(res.statusCode).toBe(200)
    expect(mock.ebook.deleteMany.mock.calls[0][0]).toEqual({ where: { authorId: 1 } })
    expect(mock.user.delete.mock.calls[0][0]).toEqual({ where: { id: 1 } })
  })

  it('refuses while a paid plan is still renewing', async () => {
    mock.userSubscription.findUnique.mockResolvedValue({ status: 'active', cancelledAt: null, paymentProvider: 'paddle', expiresAt: new Date(Date.now() + 86_400_000) })
    const res = await call('DELETE', '/api/users/me', { password: 'right-password' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('paid_plan')
  })

  it('allows it once the plan is cancelled, or on a trial', async () => {
    mock.userSubscription.findUnique.mockResolvedValue({ status: 'active', cancelledAt: new Date(), paymentProvider: 'paddle', expiresAt: new Date(Date.now() + 86_400_000) })
    expect((await call('DELETE', '/api/users/me', { password: 'right-password' })).statusCode).toBe(200)
    mock.userSubscription.findUnique.mockResolvedValue({ status: 'trial', cancelledAt: null, paymentProvider: null, expiresAt: new Date(Date.now() + 86_400_000) })
    expect((await call('DELETE', '/api/users/me', { password: 'right-password' })).statusCode).toBe(200)
  })

  it('refuses a club owner whose club still has coaches', async () => {
    mock.club.findUnique.mockResolvedValue({ _count: { members: 3 } })
    const res = await call('DELETE', '/api/users/me', { password: 'right-password' })
    expect(res.json().error).toBe('club_owner')
  })

  it('refuses an author with books in the shop or in review', async () => {
    mock.ebook.count.mockResolvedValue(1)
    const res = await call('DELETE', '/api/users/me', { password: 'right-password' })
    expect(res.json().error).toBe('books')
    expect(mock.user.delete).not.toHaveBeenCalled()
  })

  it('never deletes the owner account from here', async () => {
    account({ role: 'owner' })
    const res = await call('DELETE', '/api/users/me', { password: 'right-password' })
    expect(res.statusCode).toBe(409)
  })
})
