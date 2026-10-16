// EMAIL-FAIL (14 Oct 2026) — two Sentry errors from production, and the ask
// that came with them: "when a user's email is not correct, show it in the
// users list, and show the failure in the history".
//
//   1. "No recipients defined": a send with a blank address reached SMTP.
//      Now sendMail checks the address first and records a plain reason.
//      A blank SUPPORT_EMAIL= no longer beats the MAIL_FROM fallback.
//   2. ZodError on an empty login form went to Sentry. Validation errors and
//      4xx answers are not faults.
//   3. Admin → Users says who cannot be emailed, and why.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'

vi.unmock('../src/config/mailer.js')
vi.mock('../src/config/env.js', async (orig) => {
  const actual = await orig<typeof import('../src/config/env.js')>()
  return { ...actual, env: { ...actual.env, SMTP_HOST: 'smtp.test', SMTP_USER: 'user', SMTP_PASS: 'pass' } }
})
const smtpSend = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtpSend }) } }))

import { sendMail } from '../src/config/mailer.js'
import { recipientProblem, isInvalidRecipient, NO_ADDRESS, BAD_ADDRESS } from '../src/lib/email-address.js'
import { blankAsUnset } from '../src/config/env.js'
import { shouldReportRequestError } from '../src/lib/sentry-filter.js'
import { emailIssuesFor } from '../src/modules/admin/email-issues.js'
import { UserFilters } from '../src/modules/admin/user-filters.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

beforeEach(() => vi.clearAllMocks())

describe('EMAIL-FAIL · the address is checked before anything is sent', () => {
  it('knows an address from a non-address', () => {
    expect(recipientProblem('coach@club.co.uk')).toBeNull()
    expect(recipientProblem('TactiCoach <info@tacticoach.co.uk>')).toBeNull()
    expect(recipientProblem('')).toBe(NO_ADDRESS)
    expect(recipientProblem('   ')).toBe(NO_ADDRESS)
    expect(recipientProblem(undefined)).toBe(NO_ADDRESS)
    expect(recipientProblem('coach@club')).toBe(BAD_ADDRESS)
    expect(recipientProblem('coach club@x.com')).toBe(BAD_ADDRESS)
    expect(recipientProblem('coach@@x.com')).toBe(BAD_ADDRESS)
  })

  it('a blank recipient is recorded as failed with a plain reason, and SMTP is never called', async () => {
    let thrown: unknown
    await sendMail({ to: '', subject: 'Hi', html: '<p>hi</p>', kind: 'contact', userId: 9 }).catch((e) => { thrown = e })

    expect(smtpSend).not.toHaveBeenCalled()
    expect(isInvalidRecipient(thrown)).toBe(true)
    expect(mock.emailLog.create).toHaveBeenCalledTimes(1)
    expect(mock.emailLog.create.mock.calls[0][0].data).toMatchObject({
      to: '', status: 'failed', error: NO_ADDRESS, userId: 9, kind: 'contact',
    })
  })

  it('a malformed address is recorded too', async () => {
    await sendMail({ to: 'sam@gmail', subject: 'Hi', html: '<p>hi</p>' }).catch(() => {})
    expect(smtpSend).not.toHaveBeenCalled()
    expect(mock.emailLog.create.mock.calls[0][0].data).toMatchObject({ status: 'failed', error: BAD_ADDRESS })
  })

  it('a good address still goes out', async () => {
    smtpSend.mockResolvedValue({})
    await sendMail({ to: 'coach@club.co.uk', subject: 'Hi', html: '<p>hi</p>' })
    expect(smtpSend).toHaveBeenCalledTimes(1)
    expect(mock.emailLog.create.mock.calls[0][0].data.status).toBe('sent')
  })

  it('a blank SUPPORT_EMAIL= line counts as not set, so the MAIL_FROM fallback applies', () => {
    expect(blankAsUnset.parse('')).toBeUndefined()
    expect(blankAsUnset.parse('   ')).toBeUndefined()
    expect(blankAsUnset.parse(undefined)).toBeUndefined()
    expect(blankAsUnset.parse(' info@tacticoach.co.uk ')).toBe('info@tacticoach.co.uk')
  })
})

describe('EMAIL-FAIL · Sentry hears about faults, not about forms filled in wrong', () => {
  it('skips validation errors and 4xx answers; keeps real faults', () => {
    expect(shouldReportRequestError({ name: 'ZodError', issues: [] })).toBe(false)
    expect(shouldReportRequestError(Object.assign(new Error('nope'), { statusCode: 401 }))).toBe(false)
    expect(shouldReportRequestError(Object.assign(new Error('gone'), { statusCode: 404 }))).toBe(false)
    expect(shouldReportRequestError(Object.assign(new Error('db down'), { statusCode: 503 }))).toBe(true)
    expect(shouldReportRequestError(new Error('boom'))).toBe(true)
  })
})

describe('EMAIL-FAIL · Admin → Users says who cannot be emailed', () => {
  it('flags a bad address, and a person whose LATEST email failed — a later success clears it', async () => {
    mock.emailLog.findMany.mockResolvedValue([
      // newest first, as the query orders them
      { userId: 2, status: 'failed', error: '550 mailbox unavailable', kind: 'account_setup', createdAt: new Date('2026-10-13T10:00:00Z') },
      { userId: 3, status: 'sent', error: null, kind: 'password_reset', createdAt: new Date('2026-10-13T09:00:00Z') },
      { userId: 3, status: 'failed', error: 'timeout', kind: 'account_setup', createdAt: new Date('2026-10-12T09:00:00Z') },
    ] as never)

    const issues = await emailIssuesFor([
      { id: 1, email: 'not-an-address' },
      { id: 2, email: 'sam@club.co.uk' },
      { id: 3, email: 'jo@club.co.uk' },
    ])

    expect(issues.get(1)).toMatchObject({ reason: 'invalid', detail: BAD_ADDRESS })
    expect(issues.get(2)).toMatchObject({ reason: 'failed', detail: '550 mailbox unavailable', kind: 'account_setup' })
    expect(issues.has(3)).toBe(false)
  })

  it('the list sends emailIssue with each user, and "Can’t be emailed" is a filter', async () => {
    dbMock.user.findUnique.mockImplementation((args?: unknown) => {
      const select = (args as { select?: Record<string, unknown> } | undefined)?.select
      const keys = select ? Object.keys(select) : []
      if (keys.length > 0 && keys.every((k) => k === 'role' || k === 'accountType')) {
        return Promise.resolve({ role: 'owner', accountType: 'coach' } as never)
      }
      return Promise.resolve({ id: 1, role: 'owner', accountType: 'coach' } as never)
    })
    const row = {
      id: 7, name: 'Sam', surname: 'Lee', email: 'sam@club', clubName: null, emailVerifiedAt: null,
      createdAt: new Date(), role: 'user', accountType: 'coach', freeTrialEndsAt: null, ownedClub: null,
      clubMembership: null, subscription: null, _count: { boards: 0, drillSheets: 0 },
    }
    mock.user.findMany.mockResolvedValue([row] as never)
    mock.user.count.mockResolvedValue(1 as never)
    mock.emailLog.findMany.mockResolvedValue([] as never)
    ;(dbMock as unknown as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw.mockResolvedValue([{ user_id: 7 }] as never)

    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/users?email=problem', headers: authHeaders(await accessToken()) })

    expect(res.statusCode).toBe(200)
    expect(res.json().users[0].emailIssue).toMatchObject({ reason: 'invalid' })
    const where = JSON.stringify(mock.user.findMany.mock.calls[0][0].where)
    expect(where).toContain('"in":[7]')
    expect(UserFilters.parse({ email: 'problem' }).email).toBe('problem')
    expect(UserFilters.parse({ email: 'nonsense' }).email).toBeUndefined()
  })
})
