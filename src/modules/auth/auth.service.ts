import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from '../../config/database.js'
import { env } from '../../config/env.js'
import type { RegisterInput, LoginInput } from './auth.schema.js'

const BCRYPT_ROUNDS = 12
// Refresh tokens live 30 days
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
// Password-reset links expire after 1 hour.
const RESET_TTL_MS = 60 * 60 * 1000

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex')
// Every new account gets a 7-day full-access trial (pro-ai features).
const TRIAL_DAYS = 7
const TRIAL_PLAN_SLUG = 'pro-ai'

export async function registerUser(input: RegisterInput) {
  const exists = await db.user.findUnique({ where: { email: input.email } })
  if (exists) {
    const err = new Error('Email already in use') as Error & { statusCode: number }
    err.statusCode = 409
    throw err
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
  const user = await db.user.create({
    data: {
      name: input.name,
      surname: input.surname,
      email: input.email,
      phone: input.phone ?? null,
      passwordHash,
      // The configured company-owner account gets the admin role immediately.
      ...(env.OWNER_EMAIL && input.email === env.OWNER_EMAIL ? { role: 'owner' as const } : {}),
    },
    select: { id: true, name: true, surname: true, email: true },
  })

  // Start the 7-day trial. Missing plan (unseeded DB) must not block signup —
  // the user simply starts without editor access.
  const trialPlan = await db.membershipPlan.findUnique({ where: { slug: TRIAL_PLAN_SLUG } })
  if (trialPlan) {
    await db.userSubscription.create({
      data: {
        userId: user.id,
        planId: trialPlan.id,
        status: 'trial',
        expiresAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      },
    })
  }

  return user
}

export async function validateCredentials(input: LoginInput) {
  const user = await db.user.findUnique({ where: { email: input.email } })
  if (!user) return null
  const valid = await bcrypt.compare(input.password, user.passwordHash)
  return valid ? user : null
}

// Refresh tokens are stored HASHED (like the reset tokens below): a leaked
// database dump must not hand an attacker every user's live session. The raw
// token only ever exists client-side; we hash on the way in and look up by hash.
export async function saveRefreshToken(userId: number, token: string) {
  await db.refreshToken.create({
    data: {
      userId,
      token: sha256(token),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  })
}

export async function rotateRefreshToken(oldToken: string, userId: number, newToken: string) {
  await db.refreshToken.deleteMany({ where: { token: sha256(oldToken) } })
  await saveRefreshToken(userId, newToken)
}

export async function revokeRefreshToken(token: string) {
  await db.refreshToken.deleteMany({ where: { token: sha256(token) } })
}

export async function findRefreshToken(token: string) {
  return db.refreshToken.findUnique({
    where: { token: sha256(token) },
    include: { user: true },
  })
}

// ---- Password reset ---------------------------------------------------------

/**
 * Issue a reset token for `email`. Returns the RAW token (to email) + the user,
 * or null when no account matches — callers must give the SAME generic response
 * either way so the endpoint can't be used to discover which emails are registered.
 * Only the token's hash is persisted.
 */
export async function createPasswordResetToken(
  email: string,
): Promise<{ user: { id: number; name: string; email: string }; token: string } | null> {
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  })
  if (!user) return null

  // Invalidate any outstanding tokens for this user, then issue a fresh one.
  await db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } })
  const token = crypto.randomBytes(32).toString('hex')
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  })
  return { user, token }
}

/**
 * Consume a reset token and set a new password. Returns true on success, false
 * when the token is missing, already used, or expired. Also revokes the user's
 * refresh tokens so existing sessions can't outlive the password change.
 */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } })
  if (!record || record.usedAt || record.expiresAt < new Date()) return false

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  await db.$transaction([
    db.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    db.refreshToken.deleteMany({ where: { userId: record.userId } }),
  ])
  return true
}
