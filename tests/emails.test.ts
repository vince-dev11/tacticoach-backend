// Email integration — welcome, purchase confirmation, trial reminders,
// contact form and club invites. SMTP is mocked in tests/setup.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders, userRow, activeSubscription } from './helpers.js'
import { isMailConfigured, sendMail } from '../src/config/mailer.js'
import { activateSubscription } from '../src/modules/membership/membership.service.js'
import { sweepTrialReminders } from '../src/jobs/trial-reminders.js'

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

const registerBody = {
  name: 'Test',
  surname: 'Coach',
  email: 'coach@test.dev',
  password: 'password123',
}

function mockRegisterDb() {
  dbMock.user.findUnique.mockResolvedValue(null)
  dbMock.user.create.mockResolvedValue(userRow() as never)
  dbMock.membershipPlan.findUnique.mockResolvedValue({ id: 2, slug: 'pro-ai' } as never)
  dbMock.userSubscription.create.mockResolvedValue({} as never)
  dbMock.refreshToken.create.mockResolvedValue({} as never)
}

describe('welcome email on register', () => {
  it('sends a welcome email to the new user', async () => {
    const app = await getApp()
    mockRegisterDb()

    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: registerBody })
    expect(res.statusCode).toBe(201)

    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1))
    const mail = sendMailMock.mock.calls[0][0]
    expect(mail.to).toBe('coach@test.dev')
    expect(mail.subject).toMatch(/welcome/i)
    expect(mail.subject).toMatch(/7-day free trial/i)
    expect(mail.text).toContain('/dashboard')
    expect(mail.html).toContain('/verify-email?token=')
  })

  it('registration still succeeds when email delivery fails', async () => {
    const app = await getApp()
    mockRegisterDb()
    sendMailMock.mockRejectedValue(new Error('SMTP down'))

    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: registerBody })
    expect(res.statusCode).toBe(201)
  })

  it('skips the email (without failing) when SMTP is not configured', async () => {
    const app = await getApp()
    mockRegisterDb()
    mailConfigured.mockReturnValue(false)

    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: registerBody })
    expect(res.statusCode).toBe(201)
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})

describe('purchase confirmation email (Stripe webhook path)', () => {
  it('emails the user when their subscription activates', async () => {
    dbMock.userSubscription.upsert.mockResolvedValue({} as never)
    dbMock.membershipPlan.findUnique.mockResolvedValue({ name: 'Pro AI', slug: 'pro-ai' } as never)
    dbMock.user.findUniqueOrThrow.mockResolvedValue(userRow() as never)

    const expiresAt = new Date(Date.now() + 30 * 86400_000)
    await activateSubscription({
      userId: 1,
      planId: 2,
      billingCycle: 'monthly',
      providerSubscriptionId: 'sub_123',
      expiresAt,
    })

    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1))
    const mail = sendMailMock.mock.calls[0][0]
    expect(mail.to).toBe('coach@test.dev')
    expect(mail.subject).toContain('Pro AI')
    expect(mail.text).toContain('billed monthly')
    expect(mail.text).toContain(expiresAt.toDateString())
  })

  it('still creates the club for club-plan purchases (email is best-effort)', async () => {
    dbMock.userSubscription.upsert.mockResolvedValue({} as never)
    dbMock.membershipPlan.findUnique.mockResolvedValue({ name: 'Club', slug: 'club' } as never)
    dbMock.user.findUniqueOrThrow.mockResolvedValue(userRow({ clubName: 'FC Test' }) as never)
    dbMock.club.upsert.mockResolvedValue({} as never)
    sendMailMock.mockRejectedValue(new Error('SMTP down'))

    await activateSubscription({
      userId: 1,
      planId: 3,
      billingCycle: 'annual',
      providerSubscriptionId: 'sub_456',
      expiresAt: null,
    })

    expect(dbMock.club.upsert).toHaveBeenCalled()
  })
})

describe('trial reminder sweep', () => {
  const dueSub = (id = 1) => ({
    ...activeSubscription({
      id,
      status: 'trial',
      expiresAt: new Date(Date.now() + 1.5 * 86400_000), // inside the 2-day window
      trialReminderSentAt: null,
    }),
    user: { id: 1, name: 'Test', email: 'coach@test.dev' },
  })

  it('emails users whose trial ends within 2 days and claims the row first', async () => {
    dbMock.userSubscription.findMany.mockResolvedValue([dueSub()] as never)
    dbMock.userSubscription.updateMany.mockResolvedValue({ count: 1 } as never)

    const sent = await sweepTrialReminders()
    expect(sent).toBe(1)

    // Query targets the 2-day window and unsent reminders only
    const where = dbMock.userSubscription.findMany.mock.calls[0][0]!.where!
    expect(where.status).toBe('trial')
    expect(where.trialReminderSentAt).toBeNull()

    // Row claimed with a null-guard (no double sends)
    expect(dbMock.userSubscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 1, trialReminderSentAt: null }),
      }),
    )

    const mail = sendMailMock.mock.calls[0][0]
    expect(mail.to).toBe('coach@test.dev')
    expect(mail.subject).toMatch(/trial ends in 2 days/i)
    expect(mail.html).toContain('#pricing')
  })

  it('does not email when another sweep already claimed the row', async () => {
    dbMock.userSubscription.findMany.mockResolvedValue([dueSub()] as never)
    dbMock.userSubscription.updateMany.mockResolvedValue({ count: 0 } as never)

    const sent = await sweepTrialReminders()
    expect(sent).toBe(0)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('does nothing when no trials are due', async () => {
    dbMock.userSubscription.findMany.mockResolvedValue([] as never)

    const sent = await sweepTrialReminders()
    expect(sent).toBe(0)
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/contact', () => {
  const payload = {
    first_name: 'Vince',
    last_name: 'Coach',
    email: 'vince@test.dev',
    message: 'Hello, I have a question about the club plan.',
  }

  it('delivers the message to the support inbox', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/contact', payload })
    expect(res.statusCode).toBe(200)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const mail = sendMailMock.mock.calls[0][0]
    expect(mail.subject).toContain('Vince Coach')
    expect(mail.text).toContain('vince@test.dev')
    expect(mail.text).toContain(payload.message)
  })

  it('rejects invalid submissions with 422', async () => {
    const app = await getApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/contact',
      payload: { ...payload, email: 'not-an-email', message: 'short' },
    })
    expect(res.statusCode).toBe(422)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('returns 503 when SMTP is not configured', async () => {
    const app = await getApp()
    mailConfigured.mockReturnValue(false)
    const res = await app.inject({ method: 'POST', url: '/api/contact', payload })
    expect(res.statusCode).toBe(503)
  })

  it('returns 502 when delivery fails (message must not vanish silently)', async () => {
    const app = await getApp()
    sendMailMock.mockRejectedValue(new Error('SMTP down'))
    const res = await app.inject({ method: 'POST', url: '/api/contact', payload })
    expect(res.statusCode).toBe(502)
  })
})

describe('club invite email', () => {
  it('emails the invited coach the accept link', async () => {
    const app = await getApp()
    // Entitlements: active club owner
    dbMock.userSubscription.findUnique.mockResolvedValue(
      activeSubscription({ plan: { id: 3, name: 'Club', slug: 'club', maxTeamMembers: 10 } }) as never,
    )
    dbMock.clubMember.findUnique.mockResolvedValue(null)
    dbMock.club.findUnique.mockResolvedValue({
      id: 1,
      ownerId: 1,
      name: 'FC Test',
      createdAt: new Date(),
      updatedAt: new Date(),
      members: [],
      invites: [],
      owner: { subscription: activeSubscription({ plan: { id: 3, name: 'Club', slug: 'club', maxTeamMembers: 10 } }) },
    } as never)
    dbMock.clubInvite.create.mockResolvedValue({
      id: 7,
      clubId: 1,
      email: 'newcoach@t.dev',
      token: 'invitetoken',
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 14 * 86400_000),
      createdAt: new Date(),
    } as never)
    // Inviter lookup for the email
    dbMock.user.findUnique.mockResolvedValue(userRow() as never)

    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs/invites',
      headers: authHeaders(await accessToken()),
      payload: { email: 'newcoach@t.dev' },
    })
    expect(res.statusCode).toBe(201)

    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1))
    const mail = sendMailMock.mock.calls[0][0]
    expect(mail.to).toBe('newcoach@t.dev')
    expect(mail.subject).toContain('FC Test')
    expect(mail.html).toContain('/club/join/invitetoken')
  })
})
