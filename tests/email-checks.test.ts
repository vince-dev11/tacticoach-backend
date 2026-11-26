// DISPOSABLE-EMAIL / SAME-INBOX (25 Nov 2026, owner): sign-up and early access
// need an email the person will keep, and one account per inbox. New sign-ups
// only — existing accounts are never checked.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dbMock } from './setup.js'
import { getApp } from './helpers.js'
import { isDisposableEmail, inboxOf, NEVER_BLOCK, DISPOSABLE_MESSAGE, SAME_INBOX_MESSAGE } from '../src/lib/email-checks.js'

const signup = (email: string, extra: Record<string, unknown> = {}) => ({
  name: 'Sam', surname: 'Coach', email, password: 'Passw0rd!e2e', accountType: 'coach', ...extra,
})

describe('DISPOSABLE-EMAIL · what counts as throwaway', () => {
  it.each(['a@yopmail.com', 'b@mailinator.com', 'c@10minutemail.com', 'd@guerrillamail.com', 'e@sharklasers.com', 'f@sub.yopmail.com', 'G@YOPMAIL.COM'])('%s is refused', (e) => {
    expect(isDisposableEmail(e)).toBe(true)
  })
  it.each(['a@gmail.com', 'b@outlook.com', 'c@icloud.com', 'd@privaterelay.appleid.com', 'e@mozmail.com', 'f@duck.com', 'g@riversidefc.co.uk', 'e2e.coach.1@tacticoach.test'])('%s is fine', (e) => {
    expect(isDisposableEmail(e)).toBe(false)
  })
  it('the never-block list is the same in the API and the update script', () => {
    const script = readFileSync('scripts/never-block-domains.mjs', 'utf8')
    for (const d of NEVER_BLOCK) expect(script).toContain(`'${d}'`)
  })
})

describe('SAME-INBOX · the inbox an address really delivers to', () => {
  it('Gmail ignores dots and +tags; googlemail is gmail', () => {
    expect(inboxOf('John.Smith+club@gmail.com')).toBe('johnsmith@gmail.com')
    expect(inboxOf('j.o.h.n.smith@googlemail.com')).toBe('johnsmith@gmail.com')
  })
  it('other providers: +tags ignored, dots kept', () => {
    expect(inboxOf('sam.coach+u12@outlook.com')).toBe('sam.coach@outlook.com')
    expect(inboxOf('Sam@RiversideFC.co.uk')).toBe('sam@riversidefc.co.uk')
  })
  it('migration 71 fills existing accounts the same way and refuses nobody', () => {
    const sql = readFileSync('prisma/migrations/71_email_inbox/migration.sql', 'utf8')
    expect(sql).toMatch(/ADD COLUMN `email_inbox` VARCHAR\(191\) NULL/)
    expect(sql).toMatch(/REPLACE\(SUBSTRING_INDEX\(SUBSTRING_INDEX\(LOWER\(`email`\), '@', 1\), '\+', 1\), '\.', ''\)/)
    expect(sql).not.toMatch(/\bDROP\b|DELETE FROM|UNIQUE/i)
  })
})

describe('DISPOSABLE-EMAIL · sign-up', () => {
  beforeEach(() => {
    dbMock.user.findFirst.mockResolvedValue(null)
  })

  it('a throwaway address is refused with a clear message under the email box', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: signup('coach@yopmail.com') })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ error: 'disposable_email', message: DISPOSABLE_MESSAGE, issues: { email: [DISPOSABLE_MESSAGE] } })
    expect(dbMock.user.create).not.toHaveBeenCalled()
  })

  it('a teenager’s parent can’t be a throwaway address either (their yes is the consent)', async () => {
    const app = await getApp()
    const dob = new Date(Date.now() - 15 * 365.25 * 86_400_000).toISOString().slice(0, 10)
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: signup('teen@gmail.com', { accountType: 'player', dateOfBirth: dob, confirmAge: true, parent: { name: 'Pat', surname: 'P', email: 'pat@mailinator.com' } }),
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().issues).toEqual({ 'parent.email': [DISPOSABLE_MESSAGE] })
  })

  it('the same Gmail inbox written another way is refused (no second account, no second trial)', async () => {
    dbMock.user.findFirst.mockResolvedValue({ id: 3 } as never)
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: signup('john.smith+2@gmail.com') })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'same_inbox', issues: { email: [SAME_INBOX_MESSAGE] } })
    expect(dbMock.user.findFirst).toHaveBeenCalledWith({ where: { emailInbox: 'johnsmith@gmail.com', NOT: { email: 'john.smith+2@gmail.com' } }, select: { id: true } })
    expect(dbMock.user.create).not.toHaveBeenCalled()
  })
})

describe('DISPOSABLE-EMAIL · early access', () => {
  it('an early-access request from a throwaway address is refused; a support message is not', async () => {
    const app = await getApp()
    const ea = await app.inject({ method: 'POST', url: '/api/contact', payload: { first_name: 'Sam', last_name: 'C', email: 'x@yopmail.com', message: 'Early access please', topic: 'sales' } })
    expect(ea.statusCode).toBe(422)
    expect(ea.json().error).toBe('disposable_email')
    dbMock.contactMessage.findFirst.mockResolvedValue(null)
    dbMock.contactMessage.create.mockResolvedValue({ id: 1 } as never)
    const support = await app.inject({ method: 'POST', url: '/api/contact', payload: { first_name: 'Sam', last_name: 'C', email: 'x@yopmail.com', message: 'I cannot log in', topic: 'account' } })
    expect(support.statusCode).toBe(200)
  })
})
