// FAMILY (12 Oct 2026) — coach-created players, parent accounts and consent.
//
// The owner's rules (TACTICAL_COACH/Plan_Books_And_Family_Accounts_2026-10-12.md):
//   - only a coach creates a player account, and enters the date of birth;
//   - under 18 needs a parent account, and the parent must say yes before the
//     child's account works (the consent is the parent's, not the coach's);
//   - under 13 has no login: the child is seen through the parent's account;
//   - a parent sees their children's feedback and books, manages their logins,
//     and decides on books — a player under 18 never sees a price.

import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from '../../config/database.js'
import { env } from '../../config/env.js'
import { ADULT_AGE, OWN_LOGIN_AGE, ageOn, isMinorAccount, parseDob } from '../../lib/age.js'
import { createAccountSetupToken, createPasswordResetTokenFor } from '../auth/auth.service.js'
import {
  sendAccountSetupEmail, sendBookRecommendedEmail, sendBookRequestEmail, sendParentInviteEmail, sendPasswordResetEmail,
} from '../../lib/emails.js'
import { notesForPlayer } from '../feedback/feedback.service.js'

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex')
const randomHash = () => bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12)
/** An address that can never receive mail: an under-13 has no login and no inbox of ours. */
const placeholderEmail = () => `child-${crypto.randomBytes(9).toString('hex')}@no-login.tacticoach.invalid`
export const isPlaceholderEmail = (email: string) => email.endsWith('@no-login.tacticoach.invalid')

export class FamilyError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message) }
}

export interface ParentInput { name: string; surname: string; email: string }

function splitName(full: string): { name: string; surname: string } {
  const parts = full.trim().split(/\s+/)
  return { name: parts[0] ?? full.trim(), surname: parts.slice(1).join(' ') }
}

function checkDob(input: string, now = new Date()): Date {
  const dob = parseDob(input)
  if (!dob || dob.getTime() > now.getTime() || ageOn(dob, now) > 100) {
    throw new FamilyError(422, 'bad_dob', 'Enter a real date of birth.')
  }
  return dob
}

/**
 * The parent for a child: their existing account (any non-player account can
 * be a parent — a coach is often one), or a new parent account. A player can
 * never be anyone's parent.
 */
async function parentFor(input: ParentInput): Promise<{ id: number; name: string; email: string }> {
  const email = input.email.trim().toLowerCase()
  const found = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, accountType: true } })
  if (found) {
    if (found.accountType === 'player') throw new FamilyError(409, 'parent_is_player', "That email belongs to a player's account. Use the parent's own email.")
    return found
  }
  return db.user.create({
    data: {
      name: input.name.trim(), surname: input.surname.trim(), email,
      accountType: 'parent', passwordHash: await randomHash(), freeTrialEndsAt: null,
    },
    select: { id: true, name: true, email: true },
  })
}

/** Ask a parent to say yes for a child: a pending link and an email. */
async function inviteParent(opts: { parent: { id: number; name: string; email: string }; child: { id: number; name: string; canLogin: boolean }; coachId: number | null }) {
  const token = crypto.randomBytes(32).toString('hex')
  const data = { status: 'pending' as const, inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS), invitedById: opts.coachId }
  const existing = await db.parentLink.findUnique({ where: { parentUserId_childUserId: { parentUserId: opts.parent.id, childUserId: opts.child.id } } })
  if (existing?.status === 'active') return { alreadyActive: true }
  if (existing) await db.parentLink.update({ where: { id: existing.id }, data })
  else await db.parentLink.create({ data: { parentUserId: opts.parent.id, childUserId: opts.child.id, ...data } })
  const coach = opts.coachId ? await db.user.findUnique({ where: { id: opts.coachId }, select: { name: true, surname: true, clubName: true } }) : null
  void sendParentInviteEmail({
    selfSignup: !opts.coachId,
    to: opts.parent.email,
    parentName: opts.parent.name,
    childName: opts.child.name,
    coachName: [coach?.name, coach?.surname].filter(Boolean).join(' ') || 'Your child\'s coach',
    clubName: coach?.clubName ?? null,
    childCanLogin: opts.child.canLogin,
    inviteUrl: `${env.FRONTEND_URL}/family/invite/${token}`,
    parentId: opts.parent.id,
    actorId: opts.coachId ?? opts.child.id,
  })
  return { alreadyActive: false }
}

/**
 * A child's account is going (the parent said no, or closed it). The coach's
 * squad row goes back to "no account" — the row (name, number) stays theirs;
 * without this the row would still say "Connected" to an account that is gone.
 */
async function removeChild(childId: number) {
  await db.squadPlayer.updateMany({ where: { playerUserId: childId }, data: { playerUserId: null, linkStatus: null, linkedAt: null } })
  await db.user.delete({ where: { id: childId } })
}

async function ownRow(coachId: number, squadPlayerId: number) {
  const row = await db.squadPlayer.findFirst({
    where: { id: squadPlayerId, userId: coachId, archivedAt: null },
    select: { id: true, name: true, playerUserId: true, guardianEmail: true },
  })
  if (!row) throw new FamilyError(404, 'not_found', 'Player not found')
  return row
}

/**
 * A coach creates the account for a player on their squad.
 *
 * 18+: an ordinary player account; they choose a password from the emailed link.
 * 13–17: their own login, which works once a parent says yes.
 * Under 13: no login; the parent sees everything on their Family page.
 */
export async function createPlayerAccount(coachId: number, squadPlayerId: number, input: {
  name?: string; surname?: string; dateOfBirth: string; email?: string | null; parent?: ParentInput | null
}) {
  const row = await ownRow(coachId, squadPlayerId)
  if (row.playerUserId) throw new FamilyError(409, 'already_linked', 'This player already has an account.')
  const dob = checkDob(input.dateOfBirth)
  const age = ageOn(dob)
  const minor = age < ADULT_AGE
  const canLogin = age >= OWN_LOGIN_AGE
  const email = canLogin ? input.email?.trim().toLowerCase() : null
  if (canLogin && !email) throw new FamilyError(422, 'email_required', 'Enter the player\'s email: they will log in with it.')
  if (minor && !input.parent) throw new FamilyError(422, 'parent_required', 'A player under 18 needs a parent or guardian. Enter their name and email.')
  if (email && (await db.user.findUnique({ where: { email }, select: { id: true } }))) {
    throw new FamilyError(409, 'email_taken', 'That email already has an account. Ask them to link it instead.')
  }
  if (minor && email && input.parent && input.parent.email.trim().toLowerCase() === email) {
    throw new FamilyError(422, 'same_email', 'The parent needs their own email, not the player\'s.')
  }
  const parent = minor && input.parent ? await parentFor(input.parent) : null
  const names = input.name?.trim() ? { name: input.name.trim(), surname: input.surname?.trim() ?? '' } : splitName(row.name)

  const child = await db.user.create({
    data: {
      ...names,
      email: email ?? placeholderEmail(),
      accountType: 'player',
      dateOfBirth: dob,
      canLogin,
      passwordHash: await randomHash(),
      freeTrialEndsAt: null,
    },
    select: { id: true, name: true, email: true },
  })
  await db.squadPlayer.update({
    where: { id: row.id },
    data: { playerUserId: child.id, linkStatus: 'active', linkedAt: new Date(), guardianEmail: parent ? parent.email : row.guardianEmail },
  })

  if (parent) {
    await inviteParent({ parent, child: { id: child.id, name: child.name, canLogin }, coachId })
  } else {
    // 18+: their own set-password link, emailed to them. Never returned to the
    // coach — with it a coach could set the password of the player's account.
    const setupUrl = `${env.FRONTEND_URL}/reset-password?token=${await createAccountSetupToken(child.id)}`
    void sendAccountSetupEmail(child, setupUrl, coachId)
  }
  return { playerUserId: child.id, age, canLogin, parentInvited: !!parent }
}

/**
 * The details a player who signed up before 12 Oct 2026 is missing: their date
 * of birth, and for an under-18, a parent. Set once by their coach; from then
 * on the same rules apply as to a new account (an under-13 loses their login,
 * a 13–17 needs the parent's yes).
 */
export async function addFamilyDetails(coachId: number, squadPlayerId: number, input: { dateOfBirth: string; parent?: ParentInput | null }) {
  const row = await ownRow(coachId, squadPlayerId)
  if (!row.playerUserId) throw new FamilyError(409, 'no_account', 'Create the player\'s account first.')
  const child = await db.user.findUnique({ where: { id: row.playerUserId }, select: { id: true, name: true, dateOfBirth: true, canLogin: true } })
  if (!child) throw new FamilyError(404, 'not_found', 'Player not found')
  if (child.dateOfBirth) throw new FamilyError(409, 'dob_set', 'This player\'s date of birth is already set.')
  const dob = checkDob(input.dateOfBirth)
  const age = ageOn(dob)
  const minor = age < ADULT_AGE
  if (minor && !input.parent) throw new FamilyError(422, 'parent_required', 'A player under 18 needs a parent or guardian. Enter their name and email.')
  const canLogin = age >= OWN_LOGIN_AGE
  await db.user.update({ where: { id: child.id }, data: { dateOfBirth: dob, canLogin } })
  if (minor && input.parent) {
    const parent = await parentFor(input.parent)
    await inviteParent({ parent, child: { id: child.id, name: child.name, canLogin }, coachId })
    await db.squadPlayer.update({ where: { id: row.id }, data: { guardianEmail: parent.email } })
  }
  return { age, canLogin, parentInvited: minor }
}

/**
 * FAMILY-RESEND (12 Oct 2026): the parent never answered — the email went to
 * spam, expired after 14 days, or the coach typed the address wrong. The coach
 * sends it again, optionally to a corrected address. Without this a child
 * whose parent missed one email was stuck for good.
 *
 * A corrected address replaces the unanswered invitations: the wrong-address
 * parent account is removed when it was made for this child and never used.
 */
export async function resendParentInvite(coachId: number, squadPlayerId: number, input: { parent?: ParentInput | null }) {
  const row = await ownRow(coachId, squadPlayerId)
  if (!row.playerUserId) throw new FamilyError(409, 'no_account', 'Create the player\'s account first.')
  const child = await db.user.findUnique({ where: { id: row.playerUserId }, select: { id: true, name: true, accountType: true, dateOfBirth: true, canLogin: true } })
  if (!child || !isMinorAccount(child) || !child.dateOfBirth) throw new FamilyError(409, 'no_parent_needed', 'This player doesn\'t need a parent.')
  if (await db.parentLink.count({ where: { childUserId: child.id, status: 'active' } })) {
    throw new FamilyError(409, 'parent_active', 'A parent has already said yes for this player.')
  }
  const pending = await db.parentLink.findMany({ where: { childUserId: child.id, status: 'pending' }, select: { id: true, parentUserId: true, parent: { select: { id: true, name: true, email: true, accountType: true, emailVerifiedAt: true } } } })
  const target = input.parent ? input.parent.email.trim().toLowerCase() : null
  if (target) {
    for (const link of pending) {
      if (link.parent.email === target) continue
      await db.parentLink.delete({ where: { id: link.id } })
      // A parent account made for this invitation and never opened goes with it.
      if (link.parent.accountType === 'parent' && !link.parent.emailVerifiedAt && !(await db.parentLink.count({ where: { parentUserId: link.parent.id } }))) {
        await db.user.delete({ where: { id: link.parent.id } })
      }
    }
    const parent = await parentFor(input.parent!)
    await inviteParent({ parent, child, coachId })
    await db.squadPlayer.update({ where: { id: row.id }, data: { guardianEmail: parent.email } })
    return { sentTo: [parent.email] }
  }
  if (!pending.length) throw new FamilyError(422, 'parent_required', 'Enter the parent\'s name and email.')
  for (const link of pending) await inviteParent({ parent: link.parent, child, coachId })
  return { sentTo: pending.map((l) => l.parent.email) }
}

// ---- Sign-up (FAMILY-SIGNUP, 12 Oct 2026) ---------------------------------------
//
// A player signs up themselves with their date of birth and a tick confirming
// it. Under 13: no account at all (a parent signs up and adds them). 13–17:
// the account is made but works only after the parent says yes. 18+: ordinary.

export type SignupAge = { kind: 'under13' } | { kind: 'minor'; dob: Date } | { kind: 'adult'; dob: Date }

/** What a player sign-up's date of birth means. Throws on a nonsense date. */
export function signupAge(dateOfBirth: string): SignupAge {
  const dob = checkDob(dateOfBirth)
  const age = ageOn(dob)
  if (age < OWN_LOGIN_AGE) return { kind: 'under13' }
  return age < ADULT_AGE ? { kind: 'minor', dob } : { kind: 'adult', dob }
}

/** A 13–17 who just signed up: ask their parent. Their own email can't be the parent's. */
export async function inviteParentForSignup(child: { id: number; name: string; email: string }, parentIn: ParentInput) {
  if (parentIn.email.trim().toLowerCase() === child.email.trim().toLowerCase()) {
    throw new FamilyError(422, 'same_email', 'Your parent needs their own email, not yours.')
  }
  const parent = await parentFor(parentIn)
  await inviteParent({ parent, child: { id: child.id, name: child.name, canLogin: true }, coachId: null })
  return { parentEmail: parent.email }
}

/**
 * A parent adds their child (any age under 18). Their own sign-up and this
 * step are the consent, so the link is active at once. The child has no login
 * (no email of their own); from 13 the parent can give them one.
 */
export async function addChild(parentId: number, input: { name: string; surname: string; dateOfBirth: string }) {
  const me = await db.user.findUnique({ where: { id: parentId }, select: { id: true, accountType: true } })
  if (!me || me.accountType === 'player') throw new FamilyError(403, 'not_parent', 'Only a parent account can add a child.')
  const dob = checkDob(input.dateOfBirth)
  if (ageOn(dob) >= ADULT_AGE) throw new FamilyError(422, 'adult', 'Over 18s sign up themselves.')
  if ((await db.parentLink.count({ where: { parentUserId: parentId } })) >= 12) {
    throw new FamilyError(422, 'too_many', 'That is the most children one account can hold.')
  }
  const child = await db.user.create({
    data: {
      name: input.name.trim(), surname: input.surname.trim(),
      email: placeholderEmail(), accountType: 'player', dateOfBirth: dob, canLogin: false,
      passwordHash: await randomHash(), freeTrialEndsAt: null,
    },
    select: { id: true, name: true },
  })
  await db.parentLink.create({ data: { parentUserId: parentId, childUserId: child.id, status: 'active', consentAt: new Date(), invitedById: null } })
  return { id: child.id, age: ageOn(dob) }
}

// ---- A coach asks through the parent (FAMILY-LINK) -----------------------------

/** Coaches waiting for this parent to say which child (if any) they coach. */
export async function coachRequests(parentId: number) {
  const rows = await db.squadPlayer.findMany({
    where: { requestParentId: parentId, linkStatus: 'pending', playerUserId: null, archivedAt: null },
    select: { id: true, name: true, user: { select: { name: true, surname: true, clubName: true } } },
  })
  return rows.map((r) => ({
    id: r.id,
    playerName: r.name,
    coach: [r.user.name, r.user.surname].filter(Boolean).join(' '),
    club: r.user.clubName ?? null,
  }))
}

/** The parent answers: this child (connect), or no. */
export async function answerCoachRequest(parentId: number, rowId: number, childId: number | null) {
  const row = await db.squadPlayer.findFirst({
    where: { id: rowId, requestParentId: parentId, linkStatus: 'pending', playerUserId: null },
    select: { id: true, userId: true },
  })
  if (!row) throw new FamilyError(404, 'not_found', 'Nothing waiting')
  if (childId === null) {
    await db.squadPlayer.update({ where: { id: row.id }, data: { requestParentId: null, linkStatus: null, linkedAt: null } })
    return { connected: false }
  }
  const child = await myChild(parentId, childId)
  if (await db.squadPlayer.findFirst({ where: { userId: row.userId, playerUserId: child.id }, select: { id: true } })) {
    throw new FamilyError(409, 'in_another_row', 'This coach already has your child on their squad.')
  }
  await db.squadPlayer.update({
    where: { id: row.id },
    data: { playerUserId: child.id, linkStatus: 'active', linkedAt: new Date(), requestParentId: null },
  })
  return { connected: true }
}

/**
 * May this account log in right now? Null = yes; otherwise the reason, in
 * words a child (or a parent reading over their shoulder) understands.
 */
export async function loginRefusal(user: { id: number; accountType: string; dateOfBirth?: Date | null; canLogin?: boolean }): Promise<{ code: string; message: string } | null> {
  if (user.canLogin === false) {
    return { code: 'no_login', message: 'Players under 13 don\'t have their own login. Your parent can see everything from your coach on their Family page.' }
  }
  if (user.accountType === 'player' && user.dateOfBirth && ageOn(user.dateOfBirth) < ADULT_AGE) {
    const ok = await db.parentLink.count({ where: { childUserId: user.id, status: 'active' } })
    if (!ok) return { code: 'awaiting_parent', message: 'Your account is waiting for your parent or guardian to say yes. We\'ve emailed them.' }
  }
  return null
}

// ---- The parent's side ---------------------------------------------------------

async function linkByToken(token: string) {
  const link = await db.parentLink.findUnique({
    where: { inviteTokenHash: sha256(token) },
    include: {
      parent: { select: { id: true, name: true, surname: true, email: true, accountType: true, emailVerifiedAt: true } },
      child: { select: { id: true, name: true, surname: true, dateOfBirth: true, canLogin: true } },
    },
  })
  if (!link || !link.inviteExpiresAt || link.inviteExpiresAt.getTime() < Date.now()) return null
  return link
}

/** A parent account made by this invitation has never had a password of its own. */
const needsPassword = (p: { accountType: string; emailVerifiedAt: Date | null }) => p.accountType === 'parent' && !p.emailVerifiedAt

/** What the invitation page shows before the parent decides. */
export async function inviteInfo(token: string) {
  const link = await linkByToken(token)
  if (!link) return null
  const coach = link.invitedById ? await db.user.findUnique({ where: { id: link.invitedById }, select: { name: true, surname: true, clubName: true } }) : null
  return {
    parentName: link.parent.name,
    parentEmail: link.parent.email,
    childName: [link.child.name, link.child.surname].filter(Boolean).join(' '),
    childAge: link.child.dateOfBirth ? ageOn(link.child.dateOfBirth) : null,
    childCanLogin: link.child.canLogin,
    coachName: coach ? [coach.name, coach.surname].filter(Boolean).join(' ') : null,
    clubName: coach?.clubName ?? null,
    needsPassword: needsPassword(link.parent),
    /** FAMILY-SIGNUP: the child signed up themselves (no coach yet). */
    selfSignup: !link.invitedById,
  }
}

/**
 * The parent's answer. Yes: consent recorded, the child's account works (13+),
 * and a new parent chooses their password. No: the link and the child's
 * account are removed — an account nobody consented to is not kept.
 */
export async function answerInvite(token: string, input: { accept: boolean; password?: string | null }) {
  const link = await linkByToken(token)
  if (!link) throw new FamilyError(404, 'invite_gone', 'This invitation has expired or was already answered. Ask the coach to send it again.')
  if (!input.accept) {
    await db.parentLink.delete({ where: { id: link.id } })
    const others = await db.parentLink.count({ where: { childUserId: link.child.id, status: 'active' } })
    if (!others) await removeChild(link.child.id)
    return { accepted: false as const }
  }
  const setPassword = needsPassword(link.parent)
  if (setPassword && (!input.password || input.password.length < 8)) {
    throw new FamilyError(422, 'password_required', 'Choose a password of at least 8 characters.')
  }
  await db.parentLink.update({
    where: { id: link.id },
    data: { status: 'active', consentAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
  })
  await db.user.update({
    where: { id: link.parent.id },
    data: {
      // The invitation reached this inbox: the address is proven.
      emailVerifiedAt: new Date(),
      ...(setPassword ? { passwordHash: await bcrypt.hash(input.password!, 12) } : {}),
    },
  })
  return { accepted: true as const, email: link.parent.email }
}

async function myChild(parentId: number, childId: number) {
  const link = await db.parentLink.findFirst({
    where: { parentUserId: parentId, childUserId: childId, status: 'active' },
    include: { child: { select: { id: true, name: true, surname: true, email: true, dateOfBirth: true, canLogin: true } } },
  })
  if (!link) throw new FamilyError(404, 'not_found', 'Child not found')
  return link.child
}

/** Everything on the parent's Family page. */
export async function familyOverview(parentId: number) {
  const links = await db.parentLink.findMany({
    where: { parentUserId: parentId },
    orderBy: { createdAt: 'asc' },
    include: { child: { select: { id: true, name: true, surname: true, email: true, dateOfBirth: true, canLogin: true } } },
  })
  const children = await Promise.all(links.map(async (l) => {
    const c = l.child
    const active = l.status === 'active'
    const [feedback, requests, recommended] = active
      ? await Promise.all([
        notesForPlayer(c.id),
        db.bookRequest.findMany({
          where: { childUserId: c.id, status: 'pending' },
          orderBy: { createdAt: 'desc' },
          select: { id: true, createdAt: true, ebook: { select: { title: true, slug: true, pricePence: true } } },
        }),
        db.bookRecommendation.findMany({
          where: { playerUserId: c.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, note: true, createdAt: true, coach: { select: { name: true, surname: true } }, ebook: { select: { title: true, slug: true } } },
        }),
      ])
      : [null, [], []]
    return {
      id: c.id,
      name: c.name,
      surname: c.surname,
      age: c.dateOfBirth ? ageOn(c.dateOfBirth) : null,
      canLogin: c.canLogin,
      // A placeholder address is internal; the parent sees "no login".
      email: c.canLogin && !isPlaceholderEmail(c.email) ? c.email : null,
      mayHaveLogin: !!c.dateOfBirth && ageOn(c.dateOfBirth) >= OWN_LOGIN_AGE,
      status: l.status,
      linkId: l.id,
      feedback,
      requests: requests.map((r) => ({ id: r.id, createdAt: r.createdAt, book: r.ebook })),
      recommended: recommended.map((r) => ({ id: r.id, note: r.note, createdAt: r.createdAt, coach: [r.coach.name, r.coach.surname].filter(Boolean).join(' '), book: r.ebook })),
    }
  }))
  return { children, coachRequests: await coachRequests(parentId) }
}

/** A logged-in parent says yes to a waiting child (invited while they already had an account). */
export async function acceptPending(parentId: number, linkId: number) {
  const link = await db.parentLink.findFirst({ where: { id: linkId, parentUserId: parentId, status: 'pending' } })
  if (!link) throw new FamilyError(404, 'not_found', 'Nothing waiting')
  await db.parentLink.update({ where: { id: link.id }, data: { status: 'active', consentAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null } })
  return { ok: true }
}

export async function childResetPassword(parentId: number, childId: number) {
  const child = await myChild(parentId, childId)
  if (!child.canLogin || isPlaceholderEmail(child.email)) throw new FamilyError(409, 'no_login', 'This child has no login.')
  const token = await createPasswordResetTokenFor(child.id)
  void sendPasswordResetEmail(child, `${env.FRONTEND_URL}/reset-password?token=${token}`, parentId)
  return { sent: true }
}

export async function childChangeEmail(parentId: number, childId: number, emailIn: string) {
  const child = await myChild(parentId, childId)
  if (!child.canLogin) throw new FamilyError(409, 'no_login', 'This child has no login.')
  const email = emailIn.trim().toLowerCase()
  if (await db.user.findFirst({ where: { email, NOT: { id: child.id } }, select: { id: true } })) {
    throw new FamilyError(409, 'email_taken', 'That email already has an account.')
  }
  await db.passwordResetToken.deleteMany({ where: { userId: child.id, usedAt: null } })
  await db.user.update({ where: { id: child.id }, data: { email, emailVerifiedAt: null } })
  return { email }
}

/** A child who has turned 13 gets their own login — the parent's decision. */
export async function childEnableLogin(parentId: number, childId: number, emailIn: string) {
  const child = await myChild(parentId, childId)
  if (child.canLogin) throw new FamilyError(409, 'has_login', 'This child already has a login.')
  if (!child.dateOfBirth || ageOn(child.dateOfBirth) < OWN_LOGIN_AGE) {
    throw new FamilyError(409, 'too_young', `A login is for players aged ${OWN_LOGIN_AGE} and over.`)
  }
  const email = emailIn.trim().toLowerCase()
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw new FamilyError(409, 'email_taken', 'That email already has an account.')
  const updated = await db.user.update({ where: { id: child.id }, data: { email, canLogin: true }, select: { id: true, name: true, email: true } })
  const url = `${env.FRONTEND_URL}/reset-password?token=${await createAccountSetupToken(child.id)}`
  void sendAccountSetupEmail(updated, url, parentId)
  return { email }
}

/** Close the child's account: their login and everything kept under it. */
export async function childClose(parentId: number, childId: number) {
  const child = await myChild(parentId, childId)
  await removeChild(child.id)
  return { closed: true }
}

export async function answerBookRequest(parentId: number, requestId: number, status: 'done' | 'dismissed') {
  const req = await db.bookRequest.findUnique({ where: { id: requestId }, select: { id: true, childUserId: true } })
  if (!req) throw new FamilyError(404, 'not_found', 'Request not found')
  await myChild(parentId, req.childUserId)
  await db.bookRequest.update({ where: { id: req.id }, data: { status } })
  return { status }
}

// ---- The child's side: "Ask your parent" ----------------------------------------

export async function askParent(childId: number, slug: string) {
  const user = await db.user.findUnique({ where: { id: childId }, select: { id: true, name: true, accountType: true, dateOfBirth: true } })
  if (!user || !isMinorAccount(user)) throw new FamilyError(403, 'not_a_child', 'Only players under 18 ask a parent.')
  const book = await db.ebook.findFirst({ where: { slug, status: 'published', clubId: null }, select: { id: true, title: true, pricePence: true } })
  if (!book) throw new FamilyError(404, 'not_found', 'Book not found')
  if (book.pricePence <= 0) throw new FamilyError(409, 'free', 'This book is free — you can read it now.')
  await db.bookRequest.upsert({
    where: { childUserId_ebookId: { childUserId: childId, ebookId: book.id } },
    update: { status: 'pending' },
    create: { childUserId: childId, ebookId: book.id },
  })
  const parents = await db.parentLink.findMany({
    where: { childUserId: childId, status: 'active' },
    select: { parent: { select: { id: true, name: true, email: true } } },
  })
  for (const { parent } of parents) {
    void sendBookRequestEmail({ to: parent.email, parentName: parent.name, childName: user.name, bookTitle: book.title, familyUrl: `${env.FRONTEND_URL}/family`, parentId: parent.id })
  }
  return { asked: true, parents: parents.length }
}

// ---- The coach's side: "Recommend to my players" --------------------------------

export async function recommendBook(coachId: number, slug: string, squadPlayerIds: number[], note: string | null) {
  const book = await db.ebook.findFirst({ where: { slug, status: 'published' }, select: { id: true, title: true } })
  if (!book) throw new FamilyError(404, 'not_found', 'Book not found')
  const rows = await db.squadPlayer.findMany({
    where: { id: { in: squadPlayerIds }, userId: coachId, archivedAt: null, linkStatus: 'active', playerUserId: { not: null } },
    select: { playerUserId: true, name: true },
  })
  const coach = await db.user.findUnique({ where: { id: coachId }, select: { name: true, surname: true } })
  const coachName = [coach?.name, coach?.surname].filter(Boolean).join(' ') || 'Your coach'
  let sent = 0
  for (const r of rows) {
    const playerUserId = r.playerUserId!
    await db.bookRecommendation.upsert({
      where: { coachId_playerUserId_ebookId: { coachId, playerUserId, ebookId: book.id } },
      update: { note },
      create: { coachId, playerUserId, ebookId: book.id, note },
    })
    sent++
    const parents = await db.parentLink.findMany({ where: { childUserId: playerUserId, status: 'active' }, select: { parent: { select: { id: true, name: true, email: true } } } })
    for (const { parent } of parents) {
      void sendBookRecommendedEmail({ to: parent.email, parentName: parent.name, childName: r.name, coachName, bookTitle: book.title, bookUrl: `${env.FRONTEND_URL}/books/${slug}`, note, parentId: parent.id })
    }
  }
  return { sent }
}

/** Books a player's coaches have recommended to them. */
export async function recommendedFor(playerUserId: number) {
  const rows = await db.bookRecommendation.findMany({
    where: { playerUserId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, note: true, createdAt: true, coach: { select: { name: true, surname: true } }, ebook: { select: { title: true, slug: true, cover: true } } },
  })
  return rows.map((r) => ({ id: r.id, note: r.note, createdAt: r.createdAt, coach: [r.coach.name, r.coach.surname].filter(Boolean).join(' '), book: r.ebook }))
}
