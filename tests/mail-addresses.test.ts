// Which address sends, and where replies go.
//   now:    all three are the Gmail account (Gmail SMTP only sends as itself)
//   later:  MAIL_FROM = no-reply@, SUPPORT_EMAIL + TEAM_MAIL_FROM = info@
import { describe, it, expect, vi, afterEach } from 'vitest'
import { env } from '../src/config/env.js'
import { sendMail } from '../src/config/mailer.js'
import { buildContactEmail, sendAdminMessage } from '../src/lib/emails.js'

const actual = await vi.importActual<typeof import('../src/config/mailer.js')>('../src/config/mailer.js')
const saved = { MAIL_FROM: env.MAIL_FROM, SUPPORT_EMAIL: env.SUPPORT_EMAIL, TEAM_MAIL_FROM: env.TEAM_MAIL_FROM }
afterEach(() => Object.assign(env, saved))

describe('Reply-To on what we send', () => {
  it('points at the team inbox when mail comes from no-reply', () => {
    Object.assign(env, { SUPPORT_EMAIL: 'info@tacticoach.co.uk' })
    expect(actual.teamReplyTo('TactiCoach <no-reply@tacticoach.co.uk>')).toBe('info@tacticoach.co.uk')
  })

  it('is left off while one Gmail account is both sender and inbox', () => {
    Object.assign(env, { SUPPORT_EMAIL: 'tacticoach.co.uk@gmail.com' })
    expect(actual.teamReplyTo('TactiCoach <TactiCoach.co.uk@gmail.com>')).toBeUndefined()
  })
})

describe('the contact-form email to the team', () => {
  it('replies to the person who wrote in', () => {
    const mail = buildContactEmail({ firstName: 'A', lastName: 'B', email: 'coach@club.test', message: 'Hello there' })
    expect(mail.replyTo).toBe('coach@club.test')
  })
})

describe('emails written in Admin', () => {
  it('come from TEAM_MAIL_FROM when it is set', async () => {
    Object.assign(env, { TEAM_MAIL_FROM: 'TactiCoach <info@tacticoach.co.uk>' })
    await sendAdminMessage({ to: 'x@test.dev', name: 'X', subject: 'Hi', body: 'Hello', kind: 'admin_message' })
    expect(vi.mocked(sendMail).mock.calls.at(-1)![0].from).toBe('TactiCoach <info@tacticoach.co.uk>')
  })

  it('fall back to MAIL_FROM (the Gmail account today)', async () => {
    Object.assign(env, { TEAM_MAIL_FROM: undefined, MAIL_FROM: 'TactiCoach <tacticoach.co.uk@gmail.com>' })
    await sendAdminMessage({ to: 'x@test.dev', name: 'X', subject: 'Hi', body: 'Hello', kind: 'admin_message' })
    expect(vi.mocked(sendMail).mock.calls.at(-1)![0].from).toBe('TactiCoach <tacticoach.co.uk@gmail.com>')
  })
})
