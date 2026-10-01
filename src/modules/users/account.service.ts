// Two self-serve account changes that used to need an email to us:
//
//   becomeCoach   — "I signed up as a player by mistake". Turns a player
//                   account into a coach account with the same fresh trial a
//                   coach signup gets. The first real support request we had
//                   was exactly this, sent four times.
//   deleteAccount — the right to erasure, without writing in. Refused, with
//                   the reason, where deleting would hurt somebody else or
//                   keep charging a card.

import bcrypt from 'bcryptjs'
import { db } from '../../config/database.js'

export class AccountError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message)
  }
}

/** The trial length lives with the rest of the trial rules in lib/free-trial. */
export { TRIAL_DAYS } from '../../lib/free-trial.js'
import { freeTrialEnd } from '../../lib/free-trial.js'

/**
 * Player → coach.
 *
 * Refused when a coach has linked this account to a squad (or asked to): that
 * account is somebody's player — possibly a child, with a guardian copied on
 * everything — and turning it into a coach account would break the coach's
 * link and change what the guardian signed up for. Those go through us.
 */
export async function becomeCoach(userId: number) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, accountType: true } })
  if (!user) throw new AccountError(404, 'not_found', 'Account not found.')
  if (user.accountType !== 'player') {
    throw new AccountError(409, 'not_player', 'This account is already a coach account.')
  }
  const linked = await db.squadPlayer.count({ where: { playerUserId: userId, linkStatus: { in: ['active', 'pending'] } } })
  if (linked > 0) {
    throw new AccountError(409, 'linked_player', 'A coach has linked this account to their squad, so it cannot be switched here. Contact us and we will sort it out.')
  }

  // The coach's free trial starts now: 14 days held on the user, no
  // subscription row (decided 1 Oct 2026). A player never had one.
  await db.user.update({ where: { id: userId }, data: { accountType: 'coach', freeTrialEndsAt: freeTrialEnd() } })
  return { ok: true as const, trialStarted: true }
}

/**
 * Delete this account, after the password is confirmed.
 *
 * Refused while it would:
 *   - keep charging them: a paid plan still renewing is cancelled first, in
 *     Billing, so the payment provider stops too;
 *   - pull a club out from under its coaches: a club owner with members
 *     hands over or closes the club first;
 *   - take published books away from their readers.
 * Everything else goes with the account (every relation to users cascades or
 * is set to null; the database enforces it). Unpublished books go first, since
 * they are the one table that refuses.
 */
export async function deleteAccount(userId: number, password: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, passwordHash: true, role: true } })
  if (!user) throw new AccountError(404, 'not_found', 'Account not found.')
  if (user.role === 'owner') {
    throw new AccountError(409, 'owner', 'The owner account cannot be deleted from here.')
  }
  const ok = await bcrypt.compare(password, user.passwordHash ?? '')
  if (!ok) throw new AccountError(403, 'wrong_password', 'That password is not right.')

  const sub = await db.userSubscription.findUnique({
    where: { userId },
    select: { status: true, cancelledAt: true, paymentProvider: true, expiresAt: true },
  })
  const stillRenewing = sub?.status === 'active' && !sub.cancelledAt && !!sub.paymentProvider &&
    (!sub.expiresAt || sub.expiresAt > new Date())
  if (stillRenewing) {
    throw new AccountError(409, 'paid_plan', 'Cancel your plan in Billing first, so you are not charged again. Then you can delete the account.')
  }

  const club = await db.club.findUnique({ where: { ownerId: userId }, select: { _count: { select: { members: true } } } })
  if (club && club._count.members > 0) {
    throw new AccountError(409, 'club_owner', 'Your club still has coaches in it. Remove them or contact us to hand the club over, then delete the account.')
  }

  const published = await db.ebook.count({ where: { authorId: userId, status: { in: ['published', 'in_review'] } } })
  if (published > 0) {
    throw new AccountError(409, 'books', 'You have books in the shop or in review. Contact us to take them down first, so readers are told.')
  }

  await db.$transaction(async () => {
    // The one relation that refuses (ebooks.author is RESTRICT): the author's
    // unpublished drafts go with them.
    await db.ebook.deleteMany({ where: { authorId: userId } })
    await db.user.delete({ where: { id: userId } })
  })
  return { ok: true as const }
}

/**
 * Change the password from inside the app (Profile). The current password is
 * checked first — a borrowed phone must not be able to lock its owner out.
 * Every other session is signed out, as a reset link does.
 */
/** True when `password` is this account's password (403 wrong_password otherwise). */
export async function checkPassword(userId: number, password: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } })
  if (!user) throw new AccountError(404, 'not_found', 'Account not found.')
  const ok = await bcrypt.compare(password, user.passwordHash ?? '')
  if (!ok) throw new AccountError(403, 'wrong_password', 'That password is not right.')
  return { ok: true as const }
}

export async function changePassword(userId: number, current: string, next: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } })
  if (!user) throw new AccountError(404, 'not_found', 'Account not found.')
  const ok = await bcrypt.compare(current, user.passwordHash ?? '')
  if (!ok) throw new AccountError(403, 'wrong_password', 'That password is not right.')
  if (current === next) throw new AccountError(422, 'same_password', 'Choose a password you have not used just now.')
  const passwordHash = await bcrypt.hash(next, 12)
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash } }),
    db.refreshToken.deleteMany({ where: { userId } }),
  ])
  return { ok: true as const }
}

/**
 * A player's parent or guardian email. It lives on the coach's squad record
 * for that player (that is where feedback notes are copied from), so this
 * writes it to every squad the player is linked to, and reads it from the
 * first. A player with no coach yet has nowhere to keep it — the profile
 * says so.
 */
export async function guardianEmailFor(userId: number): Promise<{ email: string | null; linked: boolean }> {
  const row = await db.squadPlayer.findFirst({
    where: { playerUserId: userId, linkStatus: { in: ['active', 'pending'] } },
    orderBy: { id: 'asc' },
    select: { guardianEmail: true },
  })
  return { email: row?.guardianEmail ?? null, linked: !!row }
}

export async function setGuardianEmail(userId: number, email: string | null) {
  const { count } = await db.squadPlayer.updateMany({
    where: { playerUserId: userId, linkStatus: { in: ['active', 'pending'] } },
    data: { guardianEmail: email },
  })
  if (count === 0) throw new AccountError(409, 'not_linked', 'Once a coach has added you to their squad, you can add a parent or guardian here.')
  return { email, linked: true }
}
