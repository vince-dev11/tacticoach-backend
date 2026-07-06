import bcrypt from 'bcryptjs'
import { db } from '../../config/database.js'
import type { RegisterInput, LoginInput } from './auth.schema.js'

const BCRYPT_ROUNDS = 12
// Refresh tokens live 30 days
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
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

export async function saveRefreshToken(userId: number, token: string) {
  await db.refreshToken.create({
    data: {
      userId,
      token,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  })
}

export async function rotateRefreshToken(oldToken: string, userId: number, newToken: string) {
  await db.refreshToken.deleteMany({ where: { token: oldToken } })
  await saveRefreshToken(userId, newToken)
}

export async function revokeRefreshToken(token: string) {
  await db.refreshToken.deleteMany({ where: { token } })
}

export async function findRefreshToken(token: string) {
  return db.refreshToken.findUnique({
    where: { token },
    include: { user: true },
  })
}
