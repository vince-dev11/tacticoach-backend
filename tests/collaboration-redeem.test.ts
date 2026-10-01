// The approval link actually does something.
//
// Until 30 Sep 2026 the approval email sent people without an account to
// /signup?collab=<token>, and nothing ever redeemed the token: they got an
// ordinary account and never became a collaborator. These tests pin both
// doors — signing up with the token, and opening it while signed in.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, userRow, mockUserFindUnique, accessToken, authHeaders } from './helpers.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const approved = (over: Record<string, unknown> = {}) => ({
  id: 5, status: 'approved', inviteToken: 'tok-0123456789', inviteExpiresAt: new Date(Date.now() + 86_400_000),
  organisation: 'Epsom Colts', why: 'newsletter', email: 'priya@club.test', ...over,
})

const registerBody = { name: 'Priya', surname: 'Shah', email: 'priya@club.test', password: 'password123' }

beforeEach(() => {
  vi.clearAllMocks()
  mock.user.update?.mockResolvedValue({})
  mock.collaborator.upsert.mockResolvedValue({})
  mock.collaborationApplication.update.mockResolvedValue({})
  mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'PRIYA-4K2XQ', name: 'Priya' })
})

describe('signing up through the approval link', () => {
  const signup = async (extra: Record<string, unknown>) => {
    const app = await getApp()
    mockUserFindUnique(dbMock.user.findUnique, userRow({ referralCode: 'PRIYA1' }), { whenNoSelect: null })
    dbMock.user.create.mockResolvedValue(userRow() as never)
    dbMock.membershipPlan.findUnique.mockResolvedValue(null as never)
    dbMock.refreshToken.create.mockResolvedValue({} as never)
    return app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...registerBody, ...extra } })
  }

  it('makes the new account an invited collaborator and uses up the token', async () => {
    mock.collaborationApplication.findFirst.mockResolvedValue(approved())
    const res = await signup({ collabToken: 'tok-0123456789' })
    expect(res.statusCode).toBe(201)
    expect(mock.collaborator.upsert).toHaveBeenCalledTimes(1)
    expect(mock.collaborator.upsert.mock.calls[0][0].create).toMatchObject({ status: 'invited' })
    expect(mock.collaborationApplication.update.mock.calls[0][0].data).toMatchObject({ inviteToken: null })
  })

  it('still creates the account when the token is expired', async () => {
    mock.collaborationApplication.findFirst.mockResolvedValue(approved({ inviteExpiresAt: new Date(Date.now() - 1000) }))
    const res = await signup({ collabToken: 'tok-0123456789' })
    expect(res.statusCode).toBe(201)
    expect(mock.collaborator.upsert).not.toHaveBeenCalled()
  })

  it('never makes a player account a collaborator', async () => {
    mock.collaborationApplication.findFirst.mockResolvedValue(approved())
    dbMock.user.create.mockResolvedValue(userRow({ accountType: 'player' }) as never)
    const app = await getApp()
    mockUserFindUnique(dbMock.user.findUnique, userRow({ accountType: 'player' }), { whenNoSelect: null })
    dbMock.refreshToken.create.mockResolvedValue({} as never)
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...registerBody, accountType: 'player', collabToken: 'tok-0123456789' } })
    expect(mock.collaborator.upsert).not.toHaveBeenCalled()
  })
})

describe('opening the approval link while signed in', () => {
  const redeem = async (token = 'tok-0123456789') => {
    const app = await getApp()
    return app.inject({
      method: 'POST', url: '/api/referrals/collaboration/redeem',
      headers: authHeaders(await accessToken()), payload: { token },
    })
  }

  it('invites this account and returns the statement (awaiting the agreement)', async () => {
    mockUserFindUnique(dbMock.user.findUnique, userRow({ referralCode: 'PRIYA1' }))
    mock.collaborationApplication.findFirst.mockResolvedValue(approved())
    mock.collaborator.findUnique.mockResolvedValue({
      id: 9, status: 'invited', coachRate: 0.15, clubRate: 0.2, companyName: null,
      startedAt: new Date(), endedAt: null, agreementVersion: null, agreementSignedAt: null,
    })
    mock.collaboratorCommission.findMany.mockResolvedValue([])
    mock.referral.findMany.mockResolvedValue([])
    const res = await redeem()
    expect(res.statusCode).toBe(200)
    expect(res.json().awaitingAgreement).toBe(true)
    expect(mock.collaborator.upsert).toHaveBeenCalledTimes(1)
  })

  it('says so when the link is used up or expired', async () => {
    mockUserFindUnique(dbMock.user.findUnique, userRow())
    mock.collaborationApplication.findFirst.mockResolvedValue(null)
    const res = await redeem()
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('invalid_token')
  })
})
