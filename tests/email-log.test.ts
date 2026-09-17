// Every send is recorded — including the ones that did not happen.
//
// The whole point of email_log is answering "did they get the link?" without
// asking the person. That only works if the record is unconditional, so these
// pin the three outcomes and the one rule that makes them trustworthy:
// logging lives inside sendMail, not at the call sites.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dbMock } from './setup.js'

// NOTE: tests/setup.ts mocks this module globally (so route tests never send
// mail). Without unmocking, everything below would be exercising that stub —
// isMailConfigured() returns false, sendMail does nothing, and every
// assertion fails for a reason that has nothing to do with the code.
vi.unmock('../src/config/mailer.js')

// env.ts parses process.env ONCE at module load, and ES imports are hoisted —
// so assigning process.env in the test body is already too late: the setup
// file has imported the chain before the first statement here runs. Mocking
// the module is the only reliable lever, and vi.mock hoists above imports.
vi.mock('../src/config/env.js', async (orig) => {
  const actual = await orig<typeof import('../src/config/env.js')>()
  return {
    ...actual,
    env: { ...actual.env, SMTP_HOST: 'smtp.test', SMTP_USER: 'user', SMTP_PASS: 'pass' },
  }
})

const sendMailMock = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}))

import { sendMail } from '../src/config/mailer.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const MAIL = { to: 'coach@test.dev', subject: 'Hello', html: '<p>hi</p>', kind: 'account_setup' }

beforeEach(() => vi.clearAllMocks())

describe('sendMail', () => {
  it('records a successful send', async () => {
    sendMailMock.mockResolvedValue({})

    await sendMail({ ...MAIL, userId: 7, actorId: 1 })

    expect(mock.emailLog.create).toHaveBeenCalledTimes(1)
    expect(mock.emailLog.create.mock.calls[0][0].data).toMatchObject({
      to: 'coach@test.dev',
      kind: 'account_setup',
      status: 'sent',
      userId: 7,
      actorId: 1,
      error: null,
    })
  })

  it('records a failure AND rethrows, in that order', async () => {
    // The row is what an admin looks at when someone says it never arrived, so
    // it has to exist even though the caller is about to see an exception.
    sendMailMock.mockRejectedValue(new Error('550 mailbox unavailable'))

    await expect(sendMail(MAIL)).rejects.toThrow('550 mailbox unavailable')

    expect(mock.emailLog.create).toHaveBeenCalledTimes(1)
    const data = mock.emailLog.create.mock.calls[0][0].data
    expect(data.status).toBe('failed')
    expect(data.error).toContain('550 mailbox unavailable')
  })

  it('never lets a logging failure break a delivered email', async () => {
    // The mail has gone. Throwing afterwards would tell the caller something
    // untrue, and roll back work that already happened.
    sendMailMock.mockResolvedValue({})
    mock.emailLog.create.mockRejectedValue(new Error('table is missing'))

    await expect(sendMail(MAIL)).resolves.toBeUndefined()
  })

  it('truncates a long provider error to the column width', async () => {
    sendMailMock.mockRejectedValue(new Error('x'.repeat(900)))

    await expect(sendMail(MAIL)).rejects.toThrow()
    expect(String(mock.emailLog.create.mock.calls[0][0].data.error).length).toBeLessThanOrEqual(500)
  })
})

describe('where the logging lives', () => {
  const emails = readFileSync(resolve(process.cwd(), 'src/lib/emails.ts'), 'utf8')

  it('emails.ts does not short-circuit on unconfigured SMTP', () => {
    // It used to: `if (!isMailConfigured()) return`, before sendMail was
    // reached. That is exactly the case that most needs recording, so the
    // check belongs one level down.
    expect(emails).not.toMatch(/if \(!isMailConfigured\(\)\)/)
  })

  it('every template passes a kind', () => {
    // A row of "other" in the history tells an admin nothing.
    const calls = emails.match(/await sendSafely\(/g) ?? []
    const kinds = emails.match(/^\s+'[a-z_]+',$/gm) ?? []
    expect(calls.length).toBeGreaterThan(5)
    expect(kinds.length).toBeGreaterThanOrEqual(calls.length)
  })
})
