// The "SMTP is not configured" path.
//
// Its own file because env.ts parses process.env once at module load, and
// vitest gives each test file a fresh module registry — which is the only
// clean way to import the mailer with SMTP absent.
//
// This case matters more than it looks: it is the one where somebody is
// definitely waiting for a link that is never coming. It used to return early
// from emails.ts and leave no trace at all.

import { describe, it, expect, vi } from 'vitest'
import { dbMock } from './setup.js'

// NOTE: tests/setup.ts mocks this module globally (so route tests never send
// mail). Without unmocking, everything below would be exercising that stub —
// isMailConfigured() returns false, sendMail does nothing, and every
// assertion fails for a reason that has nothing to do with the code.
vi.unmock('../src/config/mailer.js')

// Mocked rather than unset in process.env: imports are hoisted, so by the time
// a `delete process.env.X` line runs, env.ts has already been parsed.
vi.mock('../src/config/env.js', async (orig) => {
  const actual = await orig<typeof import('../src/config/env.js')>()
  return {
    ...actual,
    env: { ...actual.env, SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASS: undefined },
  }
})

const sendMailMock = vi.hoisted(() => vi.fn())
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}))

import { sendMail, isMailConfigured } from '../src/config/mailer.js'
const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

describe('sendMail with no SMTP', () => {
  it('records a skip, attempts nothing, and does not throw', async () => {
    expect(isMailConfigured()).toBe(false)

    await expect(sendMail({ to: 'a@b.c', subject: 'Hi', html: '<p/>', kind: 'account_setup' }))
      .resolves.toBeUndefined()

    expect(sendMailMock).not.toHaveBeenCalled()
    const data = mock.emailLog.create.mock.calls[0][0].data
    // `skipped`, never `failed`: the fix is configuration, not the provider,
    // and an admin reading the history needs to know which.
    expect(data.status).toBe('skipped')
    expect(data.error).toBeNull()
  })
})
