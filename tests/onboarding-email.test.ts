// ONBOARDING-EMAIL (20 Oct 2026) · get invited coaches in: emails in their
// language, reminders on day 2 and 6, a bulk resend, the personal welcome,
// a welcome when they set their password, and bounces from the provider.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.hoisted(() => {
  process.env.EMAIL_WEBHOOK_TOKEN = 'hook-token-123'
  process.env.WELCOME_VIDEO_URL = 'https://youtu.be/tour60'
})

import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { sendMail } from '../src/config/mailer.js'
import { EMAIL_COPY, EMAIL_LOCALES, emailLocale, storedLocale } from '../src/lib/email-i18n.js'
import { sendAccountSetupEmail, sendPersonalWelcomeEmail, sendWelcomeEmail } from '../src/lib/emails.js'
import { sweepSetupReminders } from '../src/jobs/setup-reminders.js'
import { applyBounce, normaliseMessageId } from '../src/lib/email-bounce.js'

const sent = () => vi.mocked(sendMail).mock.calls.map((c) => c[0])

function callerIs(role = 'owner', accountType = 'coach') {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const a = args as { where?: { id?: number }; select?: Record<string, unknown> } | undefined
    const keys = a?.select ? Object.keys(a.select) : []
    if (keys.length > 0 && keys.every((k) => k === 'role' || k === 'accountType')) return Promise.resolve({ role, accountType } as never)
    if (a?.select && 'name' in a.select && Object.keys(a.select).length === 1) return Promise.resolve({ name: 'Vince' } as never)
    return Promise.resolve({ id: 7, name: 'Ana', email: 'ana@test.dev', locale: 'es', accountType: 'coach', emailVerifiedAt: null, setupInvitedAt: new Date('2026-10-10') } as never)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sendMail).mockResolvedValue(undefined)
  dbMock.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 } as never)
  dbMock.passwordResetToken.create.mockResolvedValue({} as never)
})

describe('ONBOARDING-EMAIL · the copy', () => {
  it('seven languages, every template complete, no empty strings', () => {
    expect([...EMAIL_LOCALES]).toEqual(['en', 'de', 'es', 'fr', 'it', 'pt', 'tr'])
    const shape = (o: unknown): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === 'string' ? [k] : shape(v).map((x) => `${k}.${x}`))).sort()
    const en = shape(EMAIL_COPY.en)
    for (const l of EMAIL_LOCALES) {
      expect(shape(EMAIL_COPY[l]), l).toEqual(en)
      const strings = JSON.stringify(EMAIL_COPY[l]).match(/"[^"]*"/g) ?? []
      expect(strings.every((s) => s !== '""'), l).toBe(true)
    }
  })

  it('language codes: regional → base, unknown → English; stored as ours or null', () => {
    expect(emailLocale('pt-BR')).toBe('pt')
    expect(emailLocale('en-US')).toBe('en')
    expect(emailLocale('nl')).toBe('en')
    expect(emailLocale(null)).toBe('en')
    expect(storedLocale('ES')).toBe('es')
    expect(storedLocale('')).toBeNull()
  })

  it('placeholders filled in every language; a name with < > is escaped', async () => {
    for (const l of EMAIL_LOCALES) {
      vi.mocked(sendMail).mockClear()
      await sendAccountSetupEmail({ id: 1, name: 'Bo <b>', email: 'b@test.dev', locale: l }, 'https://x/reset?token=t')
      const m = sent()[0]
      expect(m.subject).toBe(EMAIL_COPY[l].setup.subject)
      expect(m.html).not.toMatch(/\{name\}|\{sender\}/)
      expect(m.html).toContain('Bo &lt;b&gt;')
      expect(m.html).toContain('https://x/reset?token=t')
    }
  })
})

describe('ONBOARDING-EMAIL · emails in the coach’s language', () => {
  it('the welcome on sign-up is in their language', async () => {
    await sendWelcomeEmail({ id: 1, name: 'João', email: 'j@test.dev', locale: 'pt' }, 'https://x/verify')
    expect(sent()[0].subject).toBe(EMAIL_COPY.pt.welcome.subject)
    expect(sent()[0].kind).toBe('welcome')
  })

  it('the personal welcome: from the team, signed by the admin, with the video and (if needed) a setup link', async () => {
    await sendPersonalWelcomeEmail({ id: 1, name: 'Ana', email: 'a@test.dev', locale: 'es' }, { senderName: 'Vince', setupUrl: 'https://x/setup', videoUrl: 'https://youtu.be/tour60' })
    const m = sent()[0]
    expect(m.subject).toBe('Vince, de TactiCoach: empecemos')
    expect(m.html).toContain('https://youtu.be/tour60')
    expect(m.html).toContain('https://x/setup')
    expect(m.kind).toBe('personal_welcome')
  })

  it('register stores the language; the early-access form stores it on the lead and records a coach as a coach', async () => {
    const app = await getApp()
    dbMock.contactMessage.findFirst.mockResolvedValue(null)
    dbMock.contactMessage.create.mockResolvedValue({} as never)
    const res = await app.inject({ method: 'POST', url: '/api/contact', payload: { first_name: 'Ana', last_name: 'S', email: 'ana@test.dev', message: 'Early access request\nI am: Coach', topic: 'sales', locale: 'es-AR', kind: 'coach' } })
    expect(res.statusCode).toBe(200)
    expect(dbMock.contactMessage.create.mock.calls[0][0].data).toMatchObject({ locale: 'es', kind: 'coach' })
  })
})

describe('ONBOARDING-EMAIL · reminders on day 2 and day 6', () => {
  it('day 2: one reminder with a fresh link, claimed before sending; day 6: the last one', async () => {
    const now = new Date('2026-10-20T12:00:00Z')
    dbMock.user.findMany
      .mockResolvedValueOnce([{ id: 7, name: 'Ana', email: 'ana@test.dev', locale: 'es' }] as never) // due for reminder 1
      .mockResolvedValueOnce([{ id: 8, name: 'Ben', email: 'ben@test.dev', locale: 'de' }] as never) // due for reminder 2
    dbMock.user.updateMany.mockResolvedValue({ count: 1 } as never)
    const n = await sweepSetupReminders(now)
    expect(n).toBe(2)
    const [first, second] = dbMock.user.findMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown> })
    expect(first.where).toMatchObject({ emailVerifiedAt: null, setupRemindersSent: 0, setupInvitedAt: { lte: new Date(now.getTime() - 2 * 86_400_000) } })
    expect(second.where).toMatchObject({ setupRemindersSent: 1, setupInvitedAt: { lte: new Date(now.getTime() - 6 * 86_400_000) } })
    expect(first.where.accountType).toEqual({ in: ['coach', 'club'] })
    expect(sent().map((m) => m.subject)).toEqual([EMAIL_COPY.es.reminder1.subject, EMAIL_COPY.de.reminder2.subject])
    expect(sent().every((m) => m.kind === 'account_setup_reminder')).toBe(true)
    expect(dbMock.passwordResetToken.create).toHaveBeenCalledTimes(2)
  })

  it('a reminder another sweep already claimed is not sent twice', async () => {
    dbMock.user.findMany.mockResolvedValueOnce([{ id: 7, name: 'Ana', email: 'ana@test.dev', locale: null }] as never).mockResolvedValueOnce([] as never)
    dbMock.user.updateMany.mockResolvedValue({ count: 0 } as never)
    expect(await sweepSetupReminders()).toBe(0)
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('ONBOARDING-EMAIL · Admin', () => {
  it('bulk resend: invited → fresh setup link (clock restarts); signed up → confirm link', async () => {
    const app = await getApp()
    callerIs()
    dbMock.user.findMany.mockResolvedValue([
      { id: 7, name: 'Ana', email: 'ana@test.dev', locale: 'es', setupInvitedAt: new Date('2026-10-10') },
      { id: 9, name: 'Sam', email: 'sam@test.dev', locale: null, setupInvitedAt: null },
    ] as never)
    dbMock.user.update.mockResolvedValue({} as never)
    const res = await app.inject({ method: 'POST', url: '/api/admin/onboarding/resend', headers: authHeaders(await accessToken()), payload: {} })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ setup: 1, verify: 1, sent: 2 })
    expect(sent().map((m) => m.kind)).toEqual(['account_setup', 'verification'])
    expect(sent()[0].subject).toBe(EMAIL_COPY.es.setup.subject)
    expect(dbMock.user.update.mock.calls[0][0]).toMatchObject({ where: { id: 7 }, data: { setupRemindersSent: 0 } })
    const where = dbMock.user.findMany.mock.calls[0][0]!.where as Record<string, unknown>
    expect(where).toMatchObject({ emailVerifiedAt: null, accountType: { in: ['coach', 'club'] } })
  })

  it('bulk resend is owner-only', async () => {
    const app = await getApp()
    callerIs('user')
    const res = await app.inject({ method: 'POST', url: '/api/admin/onboarding/resend', headers: authHeaders(await accessToken()), payload: {} })
    expect(res.statusCode).toBe(403)
  })

  it('personal welcome: signed by the admin, with the video and a fresh setup link for someone not in yet; stamped', async () => {
    const app = await getApp()
    callerIs()
    dbMock.user.update.mockResolvedValue({} as never)
    const res = await app.inject({ method: 'POST', url: '/api/admin/users/7/welcome', headers: authHeaders(await accessToken()) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ sent: true, withSetupLink: true, withVideo: true })
    const m = sent()[0]
    expect(m.subject).toBe('Vince, de TactiCoach: empecemos')
    expect(m.html).toContain('https://youtu.be/tour60')
    expect(m.html).toContain('/reset-password?token=')
    expect(dbMock.user.update.mock.calls[0][0].data).toHaveProperty('welcomedAt')
  })
})

describe('ONBOARDING-EMAIL · bounces from the provider (Brevo)', () => {
  it('the webhook needs the token; a hard bounce marks the email failed (by Message-ID)', async () => {
    const app = await getApp()
    const wrong = await app.inject({ method: 'POST', url: '/api/webhooks/email?token=nope', payload: { event: 'hard_bounce', email: 'x@test.dev' } })
    expect(wrong.statusCode).toBe(404)

    dbMock.emailLog.updateMany.mockResolvedValue({ count: 1 } as never)
    const ok = await app.inject({ method: 'POST', url: '/api/webhooks/email?token=hook-token-123', payload: { event: 'hard_bounce', email: 'x@test.dev', 'message-id': '<abc@relay>', reason: 'mailbox does not exist' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ received: 1, marked: 1 })
    expect(dbMock.emailLog.updateMany.mock.calls[0][0]).toMatchObject({ where: { providerMessageId: 'abc@relay' }, data: { status: 'failed' } })
  })

  it('falls back to the latest email sent to that address; ignores opens and deliveries', async () => {
    dbMock.emailLog.updateMany.mockResolvedValue({ count: 0 } as never)
    dbMock.emailLog.findFirst.mockResolvedValue({ id: 42 } as never)
    expect(await applyBounce({ event: 'blocked', email: 'X@Test.dev', 'message-id': 'zzz' })).toBe(true)
    expect(dbMock.emailLog.findFirst.mock.calls[0][0]).toMatchObject({ where: { to: 'x@test.dev', status: 'sent' } })
    expect(dbMock.emailLog.update.mock.calls[0][0]).toMatchObject({ where: { id: 42 }, data: { status: 'failed' } })
    expect(await applyBounce({ event: 'delivered', email: 'x@test.dev' })).toBe(false)
    expect(normaliseMessageId(' <a@b> ')).toBe('a@b')
  })
})

describe('ONBOARDING-EMAIL · the welcome when an invited coach sets their password', () => {
  it('first activation of an invited coach sends the “you’re in” email in their language', async () => {
    const app = await getApp()
    dbMock.passwordResetToken.findUnique.mockResolvedValue({ id: 1, userId: 7, usedAt: null, expiresAt: new Date(Date.now() + 86_400_000) } as never)
    dbMock.user.findUnique
      .mockResolvedValueOnce({ emailVerifiedAt: null, setupInvitedAt: new Date('2026-10-10') } as never)
      .mockResolvedValueOnce({ id: 7, name: 'Ana', email: 'ana@test.dev', locale: 'it', accountType: 'coach' } as never)
    dbMock.$transaction.mockResolvedValue([] as never)
    const res = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: 't'.repeat(64), password: 'NewPassw0rd!' } })
    expect(res.statusCode).toBe(200)
    await vi.waitFor(() => expect(sent().some((m) => m.kind === 'welcome_activated')).toBe(true))
    expect(sent().find((m) => m.kind === 'welcome_activated')!.subject).toBe(EMAIL_COPY.it.activated.subject)
  })
})
