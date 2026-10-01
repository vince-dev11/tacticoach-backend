// Admin → Users "send email" options, and Admin → Leads "reply by email".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { isMailConfigured, sendMail } from '../src/config/mailer.js'

const mailConfigured = vi.mocked(isMailConfigured)
const sendMailMock = vi.mocked(sendMail)
const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const target = { id: 9, name: 'Pedro', surname: 'T', email: 'pedro@test.dev', emailVerifiedAt: null as Date | null }

function asOwnerLooking(at: Partial<typeof target> = {}) {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const keys = Object.keys((args as { select?: Record<string, unknown> } | undefined)?.select ?? {})
    if (keys.length && keys.every((k) => k === 'role' || k === 'accountType')) {
      return Promise.resolve({ role: 'owner', accountType: 'coach' } as never)
    }
    return Promise.resolve({ ...target, ...at } as never)
  })
}

const lead = { id: 3, firstName: 'William', lastName: 'Alberti', email: 'will@test.dev', status: 'new', message: 'I signed up as a player by mistake <help>' }

async function post(url: string, payload?: unknown) {
  const app = await getApp()
  return app.inject({ method: 'POST', url, headers: authHeaders(await accessToken()), payload: payload as never })
}

beforeEach(() => {
  vi.clearAllMocks()
  mailConfigured.mockReturnValue(true)
  sendMailMock.mockReset()
  sendMailMock.mockResolvedValue(undefined)
  asOwnerLooking()
})

describe('Admin → Users → send email', () => {
  it('writes a message in the branded layout, escaped, with replies going to support', async () => {
    const res = await post('/api/admin/users/9/message', { subject: 'Your account', body: 'Hi Pedro,\n\nAll <sorted> now.' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('sent')
    const mail = sendMailMock.mock.calls[0][0]
    expect(mail).toMatchObject({ to: 'pedro@test.dev', subject: 'Your account', kind: 'admin_message', userId: 9 })
    expect(mail.html).toContain('All &lt;sorted&gt; now.')
    expect(mail.html).not.toContain('<sorted>')
  })

  it('reports a failed send instead of claiming it went', async () => {
    sendMailMock.mockRejectedValue(new Error('SMTP down'))
    const res = await post('/api/admin/users/9/message', { subject: 'Hello', body: 'Testing one two' })
    expect(res.json().status).toBe('failed')
  })

  it('resends the verification link to an unverified address', async () => {
    const res = await post('/api/admin/users/9/email/verify')
    expect(res.statusCode).toBe(200)
    expect(res.json().url).toMatch(/\/verify-email\?token=/)
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({ kind: 'verification', to: 'pedro@test.dev' })
  })

  it('does not resend it once verified', async () => {
    asOwnerLooking({ emailVerifiedAt: new Date() })
    const res = await post('/api/admin/users/9/email/verify')
    expect(res.statusCode).toBe(409)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('sends the trial reminder only while a trial is running', async () => {
    mock.userSubscription.findUnique.mockResolvedValue({ status: 'active', expiresAt: new Date(Date.now() + 86_400_000) })
    expect((await post('/api/admin/users/9/email/trial_reminder')).statusCode).toBe(409)
    mock.userSubscription.findUnique.mockResolvedValue({ status: 'trial', expiresAt: new Date(Date.now() + 2 * 86_400_000) })
    expect((await post('/api/admin/users/9/email/trial_reminder')).statusCode).toBe(200)
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({ kind: 'trial_reminder' })
  })
})

describe('Admin → Leads → reply by email', () => {
  beforeEach(() => {
    mock.contactMessage.findFirst.mockResolvedValue(lead)
    mock.contactMessage.update.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ ...lead, ...a.data }))
  })

  it('emails them, quotes what they wrote, and marks a new lead replied', async () => {
    const res = await post('/api/admin/leads/3/reply', { subject: 'Re: your account', body: 'Hi William, done!' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'sent', lead: { status: 'replied' } })
    const mail = sendMailMock.mock.calls[0][0]
    expect(mail).toMatchObject({ to: 'will@test.dev', kind: 'lead_reply' })
    expect(mail.html).toContain('You wrote:')
    expect(mail.html).toContain('by mistake &lt;help&gt;')
    expect(mail.html).toContain('because you wrote to us')
  })

  it('leaves the status alone when the mail failed', async () => {
    sendMailMock.mockRejectedValue(new Error('SMTP down'))
    const res = await post('/api/admin/leads/3/reply', { subject: 'Re: hi', body: 'Hello there' })
    expect(res.json().status).toBe('failed')
    expect(mock.contactMessage.update).not.toHaveBeenCalled()
  })

  it('does not mark it replied when email is not configured', async () => {
    mailConfigured.mockReturnValue(false)
    const res = await post('/api/admin/leads/3/reply', { subject: 'Re: hi', body: 'Hello there' })
    expect(res.json().status).toBe('skipped')
    expect(mock.contactMessage.update).not.toHaveBeenCalled()
  })

  it('needs a subject and a body', async () => {
    const res = await post('/api/admin/leads/3/reply', { subject: '', body: '' })
    expect(res.statusCode).toBe(422)
  })

  it('404s for a lead that does not exist', async () => {
    mock.contactMessage.findFirst.mockResolvedValue(null)
    const res = await post('/api/admin/leads/99/reply', { subject: 'Re: hi', body: 'Hello there' })
    expect(res.statusCode).toBe(404)
  })
})
