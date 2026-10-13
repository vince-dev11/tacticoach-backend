// FAMILY (12 Oct 2026) — coach-created players, parent accounts, consent.
//
// The rules worth breaking a build over:
//   - nobody signs up as a player; the coach creates one, with a date of birth
//   - under 18 needs a parent, and the child's account does not work until the
//     parent says yes; under 13 never has a login
//   - a parent account gets the parent product and nothing of the coach's
//   - a player under 18 never buys anything (the parent does)

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { ageOn, isMinorAccount, parseDob } from '../src/lib/age.js'
import {
  createPlayerAccount, resendParentInvite, answerInvite, loginRefusal, addChild, answerCoachRequest, signupAge, askParent, childEnableLogin, FamilyError, isPlaceholderEmail,
} from '../src/modules/family/family.service.js'

vi.mock('../src/lib/emails.js', async (orig) => ({
  ...(await orig<typeof import('../src/lib/emails.js')>()),
  sendParentInviteEmail: vi.fn(async () => {}),
  sendAccountSetupEmail: vi.fn(async () => {}),
  sendBookRequestEmail: vi.fn(async () => {}),
  sendBookRecommendedEmail: vi.fn(async () => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
}))
import * as emails from '../src/lib/emails.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const yearsAgo = (y: number) => {
  const d = new Date()
  return `${d.getUTCFullYear() - y}-01-01`
}

beforeEach(() => {
  vi.clearAllMocks()
  mock.squadPlayer.findFirst.mockResolvedValue({ id: 5, name: 'Sam Smith', playerUserId: null, guardianEmail: null })
  mock.user.create.mockImplementation(async ({ data }: { data: { email: string; name: string } }) => ({ id: data.email.startsWith('parent') ? 70 : 60, name: data.name, email: data.email }))
  mock.user.findUnique.mockResolvedValue(null)
  mock.squadPlayer.update.mockResolvedValue({})
  mock.squadPlayer.updateMany.mockResolvedValue({ count: 1 })
  mock.parentLink.findUnique.mockResolvedValue(null)
  mock.parentLink.create.mockResolvedValue({})
  mock.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 })
  mock.passwordResetToken.create.mockResolvedValue({})
})

describe('age', () => {
  it('counts whole years from the birthday itself', () => {
    expect(ageOn(new Date(Date.UTC(2014, 9, 12)), new Date(Date.UTC(2026, 9, 12)))).toBe(12)
    expect(ageOn(new Date(Date.UTC(2014, 9, 13)), new Date(Date.UTC(2026, 9, 12)))).toBe(11)
  })
  it('a player without a date of birth is treated as a child; coaches and parents never are', () => {
    expect(isMinorAccount({ accountType: 'player', dateOfBirth: null })).toBe(true)
    expect(isMinorAccount({ accountType: 'coach', dateOfBirth: null })).toBe(false)
    expect(isMinorAccount({ accountType: 'player', dateOfBirth: new Date(Date.UTC(1990, 0, 1)) })).toBe(false)
    expect(parseDob('2014-02-30')).toBeNull()
  })
})

describe('createPlayerAccount', () => {
  it('under 13: no login (placeholder email), a parent is required and invited, the squad row is linked', async () => {
    await expect(createPlayerAccount(1, 5, { dateOfBirth: yearsAgo(10) })).rejects.toMatchObject({ code: 'parent_required' })
    const r = await createPlayerAccount(1, 5, { dateOfBirth: yearsAgo(10), parent: { name: 'Pat', surname: 'Smith', email: 'parent@x.dev' } })
    expect(r).toMatchObject({ canLogin: false, parentInvited: true })
    const childData = mock.user.create.mock.calls.find((c) => (c[0] as { data: { accountType: string } }).data.accountType === 'player')![0].data
    expect(childData.canLogin).toBe(false)
    expect(isPlaceholderEmail(childData.email)).toBe(true)
    const parentData = mock.user.create.mock.calls.find((c) => (c[0] as { data: { accountType: string } }).data.accountType === 'parent')![0].data
    expect(parentData.email).toBe('parent@x.dev')
    expect(mock.parentLink.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'pending', childUserId: 60, parentUserId: 70 }) }))
    expect(mock.squadPlayer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ playerUserId: 60, linkStatus: 'active', guardianEmail: 'parent@x.dev' }) }))
    expect(emails.sendParentInviteEmail).toHaveBeenCalled()
  })

  it('13–17: their own email (login) and a parent; never the same email', async () => {
    await expect(createPlayerAccount(1, 5, { dateOfBirth: yearsAgo(15), parent: { name: 'P', surname: '', email: 'parent@x.dev' } })).rejects.toMatchObject({ code: 'email_required' })
    await expect(createPlayerAccount(1, 5, { dateOfBirth: yearsAgo(15), email: 'same@x.dev', parent: { name: 'P', surname: '', email: 'same@x.dev' } })).rejects.toMatchObject({ code: 'same_email' })
    const r = await createPlayerAccount(1, 5, { dateOfBirth: yearsAgo(15), email: 'sam@x.dev', parent: { name: 'P', surname: '', email: 'parent@x.dev' } })
    expect(r).toMatchObject({ canLogin: true, parentInvited: true })
  })

  it('18+: an ordinary player account, the set-password link emailed to them and never to the coach', async () => {
    const r = await createPlayerAccount(1, 5, { dateOfBirth: yearsAgo(20), email: 'adult@x.dev' })
    expect(r.parentInvited).toBe(false)
    expect(r).not.toHaveProperty('setupUrl')
    expect(JSON.stringify(r)).not.toContain('reset-password')
    expect(emails.sendAccountSetupEmail).toHaveBeenCalled()
  })

  it('a player account can never be a parent, and a future date of birth is refused', async () => {
    mock.user.findUnique.mockImplementation(async ({ where }: { where: { email?: string } }) => (where.email === 'kid@x.dev' ? { id: 3, name: 'Kid', email: 'kid@x.dev', accountType: 'player' } : null))
    await expect(createPlayerAccount(1, 5, { dateOfBirth: yearsAgo(10), parent: { name: 'K', surname: '', email: 'kid@x.dev' } })).rejects.toMatchObject({ code: 'parent_is_player' })
    await expect(createPlayerAccount(1, 5, { dateOfBirth: '2999-01-01', parent: { name: 'P', surname: '', email: 'p@x.dev' } })).rejects.toMatchObject({ code: 'bad_dob' })
  })
})

describe('FAMILY-RESEND · the parent never answered', () => {
  const child = { id: 60, name: 'Sam', accountType: 'player', dateOfBirth: new Date(Date.UTC(new Date().getUTCFullYear() - 10, 0, 1)), canLogin: false }
  const wrong = { id: 71, parentUserId: 71, parent: { id: 71, name: 'Pat', email: 'typo@x.dev', accountType: 'parent', emailVerifiedAt: null } }
  beforeEach(() => {
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 5, name: 'Sam Smith', playerUserId: 60, guardianEmail: 'typo@x.dev' })
    mock.user.findUnique.mockImplementation(async ({ where }: { where: { id?: number } }) => (where.id === 60 ? child : null))
    mock.parentLink.count.mockResolvedValue(0)
    mock.parentLink.findMany.mockResolvedValue([wrong])
    mock.parentLink.update.mockResolvedValue({})
    mock.parentLink.delete.mockResolvedValue({})
    mock.user.delete.mockResolvedValue({})
  })

  it('sends the same invitation again with a new link', async () => {
    mock.parentLink.findUnique.mockResolvedValue({ id: 71, status: 'pending' })
    expect(await resendParentInvite(1, 5, {})).toEqual({ sentTo: ['typo@x.dev'] })
    expect(mock.parentLink.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'pending', inviteTokenHash: expect.any(String) }) }))
    expect(emails.sendParentInviteEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'typo@x.dev' }))
  })

  it('a corrected address replaces the wrong one, and the unused wrong-address account goes', async () => {
    const r = await resendParentInvite(1, 5, { parent: { name: 'Pat', surname: '', email: 'parent@x.dev' } })
    expect(r).toEqual({ sentTo: ['parent@x.dev'] })
    expect(mock.parentLink.delete).toHaveBeenCalledWith({ where: { id: 71 } })
    expect(mock.user.delete).toHaveBeenCalledWith({ where: { id: 71 } })
    expect(emails.sendParentInviteEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'parent@x.dev' }))
  })

  it('never once a parent has said yes, and never for an adult or another coach\'s player', async () => {
    mock.parentLink.count.mockResolvedValue(1)
    await expect(resendParentInvite(1, 5, {})).rejects.toMatchObject({ code: 'parent_active' })
    mock.parentLink.count.mockResolvedValue(0)
    mock.user.findUnique.mockResolvedValue({ ...child, dateOfBirth: new Date(Date.UTC(1990, 0, 1)) })
    await expect(resendParentInvite(1, 5, {})).rejects.toMatchObject({ code: 'no_parent_needed' })
    mock.squadPlayer.findFirst.mockResolvedValue(null)
    await expect(resendParentInvite(2, 5, {})).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('FAMILY-SIGNUP · ages at sign-up', () => {
  it('under 13 / 13–17 / 18+; a nonsense date is refused', () => {
    expect(signupAge(yearsAgo(12)).kind).toBe('under13')
    expect(signupAge(yearsAgo(13)).kind).toBe('minor')
    expect(signupAge(yearsAgo(17)).kind).toBe('minor')
    expect(signupAge(yearsAgo(18)).kind).toBe('adult')
    expect(() => signupAge('2999-01-01')).toThrow(FamilyError)
  })
})

describe('FAMILY-SIGNUP · a parent adds a child', () => {
  beforeEach(() => {
    mock.user.findUnique.mockResolvedValue({ id: 70, accountType: 'parent' })
    mock.parentLink.count.mockResolvedValue(0)
  })

  it('no login, a placeholder address, and the link is active (the parent is the consent)', async () => {
    const r = await addChild(70, { name: 'Mia', surname: 'P', dateOfBirth: yearsAgo(9) })
    expect(r.age).toBe(9)
    const data = mock.user.create.mock.calls[0][0].data
    expect(data).toMatchObject({ accountType: 'player', canLogin: false, freeTrialEndsAt: null })
    expect(isPlaceholderEmail(data.email)).toBe(true)
    expect(mock.parentLink.create).toHaveBeenCalledWith({ data: expect.objectContaining({ parentUserId: 70, status: 'active', consentAt: expect.any(Date) }) })
  })

  it('never an adult, and never from a player account', async () => {
    await expect(addChild(70, { name: 'A', surname: '', dateOfBirth: yearsAgo(19) })).rejects.toMatchObject({ code: 'adult' })
    mock.user.findUnique.mockResolvedValue({ id: 60, accountType: 'player' })
    await expect(addChild(60, { name: 'A', surname: '', dateOfBirth: yearsAgo(9) })).rejects.toMatchObject({ code: 'not_parent' })
  })
})

describe('FAMILY-LINK · a coach asks through the parent', () => {
  it('the coach types the parent\'s email: the row waits for the parent', async () => {
    const { requestLink } = await import('../src/modules/feedback/feedback.service.js')
    mock.squadPlayer.findFirst.mockResolvedValue({ id: 5, playerUserId: null })
    mock.user.findFirst.mockImplementation(async ({ where }: { where: { accountType?: string } }) => (where.accountType === 'player' ? null : { id: 70 }))
    expect(await requestLink(1, 5, 'parent@x.dev')).toEqual({ ok: true, viaParent: true })
    expect(mock.squadPlayer.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { playerUserId: null, requestParentId: 70, linkStatus: 'pending', linkedAt: null } })
  })

  it('the parent picks the child (only their own), or says no', async () => {
    mock.squadPlayer.findFirst.mockImplementation(async ({ where }: { where: { requestParentId?: number } }) => (where.requestParentId === 70 ? { id: 5, userId: 1 } : null))
    mock.parentLink.findFirst.mockResolvedValue({ child: { id: 61, name: 'Mia', surname: '', email: 'x', dateOfBirth: null, canLogin: false } })
    expect(await answerCoachRequest(70, 5, 61)).toEqual({ connected: true })
    expect(mock.squadPlayer.update).toHaveBeenCalledWith({ where: { id: 5 }, data: expect.objectContaining({ playerUserId: 61, linkStatus: 'active', requestParentId: null }) })
    mock.parentLink.findFirst.mockResolvedValue(null)
    await expect(answerCoachRequest(70, 5, 99)).rejects.toMatchObject({ code: 'not_found' })
    expect(await answerCoachRequest(70, 5, null)).toEqual({ connected: false })
    await expect(answerCoachRequest(71, 5, 61)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('login', () => {
  it('under 13 never logs in; 13–17 waits for the parent; with consent they log in; adults always', async () => {
    expect(await loginRefusal({ id: 1, accountType: 'player', dateOfBirth: new Date(Date.UTC(2017, 0, 1)), canLogin: false })).toMatchObject({ code: 'no_login' })
    mock.parentLink.count.mockResolvedValue(0)
    expect(await loginRefusal({ id: 1, accountType: 'player', dateOfBirth: new Date(Date.UTC(new Date().getUTCFullYear() - 15, 0, 1)), canLogin: true })).toMatchObject({ code: 'awaiting_parent' })
    mock.parentLink.count.mockResolvedValue(1)
    expect(await loginRefusal({ id: 1, accountType: 'player', dateOfBirth: new Date(Date.UTC(new Date().getUTCFullYear() - 15, 0, 1)), canLogin: true })).toBeNull()
    expect(await loginRefusal({ id: 1, accountType: 'coach', dateOfBirth: null, canLogin: true })).toBeNull()
  })
})

describe('the parent says yes or no', () => {
  const link = (over: Record<string, unknown> = {}) => ({
    id: 9, inviteExpiresAt: new Date(Date.now() + 86_400_000), invitedById: 1,
    parent: { id: 70, name: 'Pat', surname: '', email: 'parent@x.dev', accountType: 'parent', emailVerifiedAt: null },
    child: { id: 60, name: 'Sam', surname: '', dateOfBirth: new Date(Date.UTC(2012, 0, 1)), canLogin: true },
    ...over,
  })

  it('yes: consent is recorded, and a new parent must choose a password', async () => {
    mock.parentLink.findUnique.mockResolvedValue(link())
    await expect(answerInvite('t', { accept: true })).rejects.toMatchObject({ code: 'password_required' })
    mock.parentLink.update.mockResolvedValue({})
    mock.user.update.mockResolvedValue({})
    expect(await answerInvite('t', { accept: true, password: 'longenough' })).toMatchObject({ accepted: true })
    expect(mock.parentLink.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'active', consentAt: expect.any(Date), inviteTokenHash: null }) }))
  })

  it('no: the link goes, and the child account nobody consented to goes with it', async () => {
    mock.parentLink.findUnique.mockResolvedValue(link())
    mock.parentLink.delete.mockResolvedValue({})
    mock.parentLink.count.mockResolvedValue(0)
    mock.user.delete.mockResolvedValue({})
    expect(await answerInvite('t', { accept: false })).toEqual({ accepted: false })
    expect(mock.user.delete).toHaveBeenCalledWith({ where: { id: 60 } })
    // FAMILY-ROW: the coach's row goes back to "no account", not "Connected" to nothing.
    expect(mock.squadPlayer.updateMany).toHaveBeenCalledWith({ where: { playerUserId: 60 }, data: { playerUserId: null, linkStatus: null, linkedAt: null } })
  })

  it('an expired invitation is refused', async () => {
    mock.parentLink.findUnique.mockResolvedValue(link({ inviteExpiresAt: new Date(Date.now() - 1000) }))
    await expect(answerInvite('t', { accept: true, password: 'longenough' })).rejects.toBeInstanceOf(FamilyError)
  })

  it('a login for an under-13 is the parent\'s decision, and only from 13', async () => {
    mock.parentLink.findFirst.mockResolvedValue({ child: { id: 60, name: 'Sam', surname: '', email: 'child-x@no-login.tacticoach.invalid', dateOfBirth: new Date(Date.UTC(new Date().getUTCFullYear() - 10, 0, 1)), canLogin: false } })
    await expect(childEnableLogin(70, 60, 'sam@x.dev')).rejects.toMatchObject({ code: 'too_young' })
  })
})

describe('Ask your parent', () => {
  it('a child asks for a paid book; the request is kept and the parent emailed', async () => {
    mock.user.findUnique.mockResolvedValue({ id: 60, name: 'Sam', accountType: 'player', dateOfBirth: new Date(Date.UTC(2014, 0, 1)) })
    mock.ebook.findFirst.mockResolvedValue({ id: 3, title: 'Pressing', pricePence: 499 })
    mock.bookRequest.upsert.mockResolvedValue({})
    mock.parentLink.findMany.mockResolvedValue([{ parent: { id: 70, name: 'Pat', email: 'parent@x.dev' } }])
    expect(await askParent(60, 'pressing')).toEqual({ asked: true, parents: 1 })
    expect(emails.sendBookRequestEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'parent@x.dev', bookTitle: 'Pressing' }))
  })
  it('an adult does not ask anyone', async () => {
    mock.user.findUnique.mockResolvedValue({ id: 60, name: 'Sam', accountType: 'player', dateOfBirth: new Date(Date.UTC(1990, 0, 1)) })
    await expect(askParent(60, 'pressing')).rejects.toMatchObject({ code: 'not_a_child' })
  })
})

describe('routes', () => {
  it('FAMILY-SIGNUP · register refuses an under-13 player (a parent signs up instead)', async () => {
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'A', surname: 'B', email: 'a@b.dev', password: 'Passw0rd!x', accountType: 'player', dateOfBirth: yearsAgo(9), confirmAge: true } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('under_13')
  })

  it('FAMILY-SIGNUP · a parent adds a child over the API', async () => {
    const app = await getApp()
    mock.user.findUnique.mockResolvedValue({ id: 70, accountType: 'parent' })
    mock.parentLink.count.mockResolvedValue(0)
    const res = await app.inject({ method: 'POST', url: '/api/family/children', headers: authHeaders(await accessToken(70, 'parent@x.dev')), payload: { name: 'Mia', dateOfBirth: yearsAgo(9) } })
    expect(res.statusCode).toBe(201)
    expect(res.json().age).toBe(9)
  })

  it('a parent account is locked out of the coach product, and reaches /api/family', async () => {
    const app = await getApp()
    mock.user.findUnique.mockResolvedValue({ accountType: 'parent' })
    const token = await accessToken(70, 'parent@x.dev')
    const res = await app.inject({ method: 'GET', url: '/api/canvas/boards', headers: authHeaders(token) })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('PARENT_ACCOUNT')
    mock.parentLink.findMany.mockResolvedValue([])
    mock.squadPlayer.findMany.mockResolvedValue([{ id: 5, name: 'Mia', user: { name: 'Olivia', surname: 'Owner', clubName: 'Hilltop FC' } }])
    const fam = await app.inject({ method: 'GET', url: '/api/family', headers: authHeaders(token) })
    expect(fam.statusCode).toBe(200)
    expect(fam.json().coachRequests).toEqual([{ id: 5, playerName: 'Mia', coach: 'Olivia Owner', club: 'Hilltop FC' }])
  })

  it('a player under 18 cannot check out a book', async () => {
    const app = await getApp()
    mock.user.findUnique.mockResolvedValue({ accountType: 'player', dateOfBirth: new Date(Date.UTC(2014, 0, 1)) })
    const res = await app.inject({ method: 'POST', url: '/api/ebooks/pressing/checkout', headers: authHeaders(await accessToken(60)), payload: { consent: true } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('ask_parent')
  })

  it('a player or parent cannot change their account type to coach', async () => {
    const app = await getApp()
    mock.user.findUnique.mockResolvedValue({ accountType: 'player' })
    const res = await app.inject({ method: 'PATCH', url: '/api/users/me', headers: authHeaders(await accessToken(60)), payload: { accountType: 'coach' } })
    expect(res.statusCode).toBe(403)
  })
})

describe('migration 53', () => {
  it('adds the parent-request column to squad rows', () => {
    const sql = readFileSync('prisma/migrations/53_family_signup/migration.sql', 'utf8')
    expect(sql).toContain('ADD COLUMN `request_parent_id` INTEGER NULL')
    expect(sql).toContain('ON DELETE SET NULL')
  })
})

describe('migration 52', () => {
  const sql = readFileSync('prisma/migrations/52_family_accounts/migration.sql', 'utf8')
  it('adds the parent account type, date of birth, login flag and the family tables', () => {
    expect(sql).toMatch(/ENUM\('coach', 'club', 'player', 'parent'\)/)
    expect(sql).toContain('`date_of_birth` DATE NULL')
    expect(sql).toContain('`can_login` BOOLEAN NOT NULL DEFAULT true')
    for (const t of ['parent_links', 'book_requests', 'book_recommendations']) expect(sql).toContain(`CREATE TABLE \`${t}\``)
    expect(sql).toMatch(/ENUM\('u5_8', 'u9_11'/)
  })
})
