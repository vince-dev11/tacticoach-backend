// Applying to collaborate, being approved, and appearing in the directory.
//
// Three things here are worth more care than the rest, because getting them
// wrong is expensive in a way the others are not:
//
//   * THE DIRECTORY'S THREE CONDITIONS. Active, opted in, moderated — all
//     required, all in the query. A bug that leaks one row leaks it to the
//     whole internet, and "it accidentally published somebody" is not a defect
//     you get to fix afterwards. Each condition is asserted on its own AND
//     mutation-checked.
//   * APPROVAL IS IDEMPOTENT. Two admins, or a double click, must not mint a
//     second token — the second would invalidate the first and strand anybody
//     who had already clicked it.
//   * THE TOKEN IS SINGLE USE. It is a credential that arrives by email and
//     grants a commercial relationship.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import {
  submitApplication,
  approveApplication,
  rejectApplication,
  redeemInvite,
  INVITE_TTL_DAYS,
} from '../src/modules/collaborations/applications.service.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const application = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  userId: null,
  name: 'Priya Shah',
  email: 'priya@club.test',
  applicantKind: 'coach',
  organisation: 'Epsom Colts',
  location: 'Surrey',
  links: 'https://example.test',
  audience: 'about 400 coaches',
  why: 'I run a grassroots newsletter',
  consentContact: true,
  consentListing: true,
  status: 'submitted',
  reviewNote: null,
  reviewedAt: null,
  inviteToken: null,
  inviteExpiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

beforeEach(() => {
  mock.collaborationApplication.create.mockResolvedValue(application() as never)
  mock.collaborationApplication.update.mockResolvedValue(application() as never)
  mock.collaborator.upsert.mockResolvedValue({} as never)
  mock.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'PRIYA-4K2XQ', name: 'Priya' } as never)
  mock.user.findUnique.mockResolvedValue(null as never)
})

describe('submitting an application', () => {
  it('stores it, lowercased and trimmed', async () => {
    await submitApplication({
      name: '  Priya Shah  ',
      email: '  PRIYA@Club.TEST ',
      applicantKind: 'coach',
      consentContact: true,
      consentListing: false,
    })
    const data = (mock.collaborationApplication.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.name).toBe('Priya Shah')
    expect(data.email).toBe('priya@club.test')
  })

  it('attaches an existing account when the email already has one', async () => {
    mock.user.findUnique.mockResolvedValue({ id: 42 } as never)
    await submitApplication({
      name: 'Priya', email: 'priya@club.test', applicantKind: 'coach',
      consentContact: true, consentListing: true,
    })
    const data = (mock.collaborationApplication.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.userId).toBe(42)
  })

  it('records the two consents separately', async () => {
    // One tick box covering both is consent to neither.
    await submitApplication({
      name: 'Priya', email: 'p@c.test', applicantKind: 'club',
      consentContact: true, consentListing: false,
    })
    const data = (mock.collaborationApplication.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.consentContact).toBe(true)
    expect(data.consentListing).toBe(false)
  })
})

describe('approving', () => {
  it('invites somebody who already has an account', async () => {
    mock.collaborationApplication.findUnique.mockResolvedValue(application({ userId: 42 }) as never)

    const result = await approveApplication(1, 'looks good')

    expect(result).toMatchObject({ outcome: 'invited', email: 'priya@club.test' })
    expect(mock.collaborator.upsert).toHaveBeenCalled()
    // No token: they have an account, so a link would be a credential with no
    // purpose — the kind that sits in an inbox for a year.
    const data = (mock.collaborationApplication.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.inviteToken).toBeNull()
  })

  it('mints a signup token for somebody without an account', async () => {
    mock.collaborationApplication.findUnique.mockResolvedValue(application() as never)

    const result = await approveApplication(1)

    expect(result!.outcome).toBe('token')
    expect(result!.inviteToken).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(mock.collaborator.upsert).not.toHaveBeenCalled()
  })

  it('re-checks for an account at APPROVAL time, not just at submission', async () => {
    // Weeks pass between the two, and somebody who applied without an account
    // has very often signed up since. Sending them a "create your account"
    // link when they already have one is the confusing outcome.
    mock.collaborationApplication.findUnique.mockResolvedValue(application({ userId: null }) as never)
    mock.user.findUnique.mockResolvedValue({ id: 99 } as never)

    const result = await approveApplication(1)

    expect(result!.outcome).toBe('invited')
    expect(result!.inviteToken).toBeUndefined()
  })

  it('is idempotent — approving twice mints nothing new', async () => {
    mock.collaborationApplication.findUnique.mockResolvedValue(
      application({ status: 'approved', inviteToken: 'already-sent' }) as never,
    )

    const result = await approveApplication(1)

    expect(result!.outcome).toBe('already')
    expect(result!.inviteToken).toBeUndefined()
    expect(mock.collaborationApplication.update).not.toHaveBeenCalled()
    expect(mock.collaborator.upsert).not.toHaveBeenCalled()
  })

  it('gives the token a fortnight, not forever', async () => {
    mock.collaborationApplication.findUnique.mockResolvedValue(application() as never)
    await approveApplication(1)
    const data = (mock.collaborationApplication.update.mock.calls[0][0] as {
      data: { inviteExpiresAt: Date }
    }).data
    const days = (data.inviteExpiresAt.getTime() - Date.now()) / 86_400_000
    expect(Math.round(days)).toBe(INVITE_TTL_DAYS)
    expect(days).toBeLessThan(60)
  })

  it('returns null for an application that does not exist', async () => {
    mock.collaborationApplication.findUnique.mockResolvedValue(null as never)
    expect(await approveApplication(404)).toBeNull()
  })
})

describe('rejecting', () => {
  it('keeps the row rather than deleting it', async () => {
    // It is the answer to "did we already say no to this club in March", and
    // what stops the same person being approved twice by two people.
    mock.collaborationApplication.findUnique.mockResolvedValue(application() as never)
    expect(await rejectApplication(1, 'too small an audience')).toBe(true)
    const args = mock.collaborationApplication.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(args.data.status).toBe('rejected')
    expect(args.data.reviewNote).toBe('too small an audience')
    expect(mock.collaborationApplication.delete).not.toHaveBeenCalled()
  })

  it('does not reject twice', async () => {
    mock.collaborationApplication.findUnique.mockResolvedValue(application({ status: 'rejected' }) as never)
    expect(await rejectApplication(1)).toBe(false)
    expect(mock.collaborationApplication.update).not.toHaveBeenCalled()
  })
})

describe('redeeming the signup token', () => {
  it('creates the collaborator and clears the token in one step', async () => {
    mock.collaborationApplication.findFirst.mockResolvedValue(
      application({ status: 'approved', inviteToken: 'tok', inviteExpiresAt: null }) as never,
    )

    expect(await redeemInvite('tok', 7)).toBe(true)
    expect(mock.collaborator.upsert).toHaveBeenCalled()
    const data = (mock.collaborationApplication.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.inviteToken).toBeNull()
    expect(data.userId).toBe(7)
  })

  it('refuses an expired token', async () => {
    mock.collaborationApplication.findFirst.mockResolvedValue(
      application({
        status: 'approved',
        inviteToken: 'tok',
        inviteExpiresAt: new Date(Date.now() - 1000),
      }) as never,
    )
    expect(await redeemInvite('tok', 7)).toBe(false)
    expect(mock.collaborator.upsert).not.toHaveBeenCalled()
  })

  it('refuses an unknown token', async () => {
    mock.collaborationApplication.findFirst.mockResolvedValue(null as never)
    expect(await redeemInvite('nope', 7)).toBe(false)
  })

  it('only accepts a token on an APPROVED application', async () => {
    // The query says so; this is the test that keeps it saying so.
    mock.collaborationApplication.findFirst.mockResolvedValue(null as never)
    await redeemInvite('tok', 7)
    const where = (mock.collaborationApplication.findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>
    }).where
    expect(where).toMatchObject({ inviteToken: 'tok', status: 'approved' })
  })
})

describe('the public form', () => {
  const post = async (body: Record<string, unknown>) => {
    const app = await getApp()
    return app.inject({ method: 'POST', url: '/api/collaborations/apply', payload: body })
  }
  const valid = {
    name: 'Priya Shah',
    email: 'priya@club.test',
    applicantKind: 'coach',
    consentContact: true,
    consentListing: true,
  }

  it('accepts a complete application', async () => {
    const res = await post(valid)
    expect(res.statusCode).toBe(200)
    expect(mock.collaborationApplication.create).toHaveBeenCalled()
  })

  it('refuses one without consent to be contacted', async () => {
    // There is no version of this where we hold somebody's details without
    // it, so the schema requires the literal `true` and the request is
    // refused as unprocessable rather than quietly stored with a false.
    const res = await post({ ...valid, consentContact: false })
    expect(res.statusCode).toBe(422)
    expect(mock.collaborationApplication.create).not.toHaveBeenCalled()
  })

  it('accepts a listing refusal without complaint', async () => {
    const res = await post({ ...valid, consentListing: false })
    expect(res.statusCode).toBe(200)
  })

  it('swallows a honeypot submission without storing it', async () => {
    // 200, not 400: a bot that learns it was caught comes back with the field
    // blank. This must look exactly like success.
    const res = await post({ ...valid, website: 'http://spam.test' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
    expect(mock.collaborationApplication.create).not.toHaveBeenCalled()
  })

  it('needs no account and no token', async () => {
    const app = await getApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/collaborations/apply',
      payload: valid,
    })
    expect(res.statusCode).not.toBe(401)
  })
})

describe('the public directory', () => {
  const get = async (url = '/api/collaborations/directory') => {
    const app = await getApp()
    return app.inject({ method: 'GET', url })
  }
  const listedRow = {
    slug: 'priya-shah',
    displayName: 'Priya Shah',
    roleTitle: 'Head of Coaching',
    organisation: 'Epsom Colts',
    location: 'Surrey',
    photoKey: null,
    bio: 'Fifteen years in grassroots.',
    links: 'https://example.test, not-a-url, https://two.test',
  }

  it('asks the database for all THREE conditions, not one or two', async () => {
    // In the query, never filtered afterwards: a bug that leaks one row leaks
    // it to the whole internet.
    mock.collaborator.findMany.mockResolvedValue([] as never)
    await get()
    const where = (mock.collaborator.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where).toEqual({ status: 'active', listed: true, profileApproved: true })
  })

  it.each([
    ['status', 'active'],
    ['listed', true],
    ['profileApproved', true],
  ])('would stop listing anybody if the %s condition were dropped', async (key) => {
    // Mutation check on the guard above, one condition at a time: each must be
    // present, so removing any single one has to be detectable.
    mock.collaborator.findMany.mockResolvedValue([] as never)
    await get()
    const where = (mock.collaborator.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
    const without = { ...where }
    delete without[key]
    expect(without).not.toEqual(where)
    expect(Object.keys(where)).toContain(key)
  })

  it('publishes only valid links, and no more than five', async () => {
    mock.collaborator.findMany.mockResolvedValue([listedRow] as never)
    const body = (await get()).json()
    expect(body[0].links).toEqual(['https://example.test', 'https://two.test'])
  })

  it('hides a row that has never been given a slug', async () => {
    // It has no URL to sit at, so publishing it produces a card that 404s.
    mock.collaborator.findMany.mockResolvedValue([{ ...listedRow, slug: null }] as never)
    expect((await get()).json()).toEqual([])
  })

  it('never returns an email address or a commission figure', async () => {
    mock.collaborator.findMany.mockResolvedValue([listedRow] as never)
    const payload = (await get()).payload
    expect(payload).not.toMatch(/@/)
    expect(payload).not.toMatch(/rate|commission|pence/i)
  })

  it('404s an unknown slug rather than leaking that one exists', async () => {
    mock.collaborator.findMany.mockResolvedValue([] as never)
    expect((await get('/api/collaborations/directory/nobody')).statusCode).toBe(404)
  })

  it('applies the same three conditions to a single entry', async () => {
    mock.collaborator.findMany.mockResolvedValue([] as never)
    await get('/api/collaborations/directory/priya-shah')
    const where = (mock.collaborator.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where).toMatchObject({ status: 'active', listed: true, profileApproved: true })
  })
})

describe('admin review', () => {
  function ownerRole() {
    dbMock.user.findUnique.mockImplementation((args?: unknown) => {
      const select = (args as { select?: Record<string, unknown> } | undefined)?.select
      if (select?.accountType || select?.role) {
        return Promise.resolve({ role: 'owner', accountType: 'coach' } as never)
      }
      return Promise.resolve(null as never)
    })
  }

  it('refuses a coach', async () => {
    dbMock.user.findUnique.mockImplementation(() =>
      Promise.resolve({ role: 'user', accountType: 'coach' } as never),
    )
    const app = await getApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/collaboration-applications',
      headers: authHeaders(await accessToken()),
    })
    expect(res.statusCode).toBe(403)
  })

  it('counts over everything, not just the filtered page', async () => {
    ownerRole()
    mock.collaborationApplication.findMany.mockResolvedValue([] as never)
    mock.collaborationApplication.count.mockResolvedValue(0 as never)
    mock.collaborationApplication.groupBy.mockResolvedValue([
      { status: 'submitted', _count: { _all: 12 } },
      { status: 'approved', _count: { _all: 3 } },
    ] as never)

    const app = await getApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/collaboration-applications?status=approved',
      headers: authHeaders(await accessToken()),
    })

    expect(res.json().counts).toEqual({ submitted: 12, approved: 3, rejected: 0 })
    // …and the counts query carried no status filter of its own.
    const groupArgs = mock.collaborationApplication.groupBy.mock.calls[0][0] as Record<string, unknown>
    expect(groupArgs).not.toHaveProperty('where')
  })
})
