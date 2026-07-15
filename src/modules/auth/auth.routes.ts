import type { FastifyInstance } from 'fastify'
import {
  RegisterSchema,
  LoginSchema,
  RefreshSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  VerifyEmailSchema,
} from './auth.schema.js'
import {
  registerUser,
  validateCredentials,
  saveRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  findRefreshToken,
  createPasswordResetToken,
  resetPasswordWithToken,
} from './auth.service.js'
import { env } from '../../config/env.js'
import { isMailConfigured, sendMail } from '../../config/mailer.js'
import { sendWelcomeEmail, sendVerificationEmail } from '../../lib/emails.js'
import { authGuard } from '../../middleware/auth-guard.js'
import { db } from '../../config/database.js'

/**
 * Per-route rate limits, tighter than the global 100/min: these endpoints are
 * unauthenticated and guard credentials (brute force) or send email (spam).
 * Relaxed under test so suites can hammer them.
 */
const limit = (max: number, timeWindow: string) => ({
  config: { rateLimit: { max: env.NODE_ENV === 'test' ? 10_000 : max, timeWindow } },
})

export async function authRoutes(app: FastifyInstance) {
  /** Stateless email-verification link: a 24h signed JWT, no DB table needed. */
  const verifyUrlFor = (userId: number, email: string) => {
    const token = app.jwt.sign({ sub: userId, email, type: 'verify-email' }, { expiresIn: '24h' })
    return `${env.FRONTEND_URL}/verify-email?token=${token}`
  }

  // POST /auth/register
  app.post('/register', limit(20, '1 hour'), async (request, reply) => {
    const input = RegisterSchema.parse(request.body)
    const user = await registerUser(input)
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: '15m' })
    const refreshToken = app.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: '30d' })
    await saveRefreshToken(user.id, refreshToken)
    // Fire-and-forget: the welcome email must never delay or fail a signup.
    void sendWelcomeEmail(user, verifyUrlFor(user.id, user.email))
    return reply.status(201).send({ user, accessToken, refreshToken })
  })

  // POST /auth/verify-email { token } — consume a verification link.
  app.post('/verify-email', async (request, reply) => {
    const { token } = VerifyEmailSchema.parse(request.body)
    let payload: { sub?: number; type?: string }
    try {
      payload = app.jwt.verify(token)
    } catch {
      return reply
        .status(400)
        .send({ statusCode: 400, error: 'Bad Request', message: 'This verification link is invalid or has expired.' })
    }
    if (payload.type !== 'verify-email' || !payload.sub) {
      return reply
        .status(400)
        .send({ statusCode: 400, error: 'Bad Request', message: 'This verification link is invalid or has expired.' })
    }
    await db.user.updateMany({
      where: { id: payload.sub, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    })
    return reply.send({ message: 'Email verified. Thanks!' })
  })

  // POST /auth/resend-verification — logged-in users can request a fresh link.
  app.post('/resend-verification', { preHandler: authGuard, ...limit(5, '15 minutes') }, async (request, reply) => {
    const userId = (request.user as { sub: number }).sub
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, emailVerifiedAt: true },
    })
    if (!user) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })
    }
    if (user.emailVerifiedAt) {
      return reply.send({ message: 'Your email is already verified.' })
    }
    void sendVerificationEmail(user, verifyUrlFor(user.id, user.email))
    return reply.send({ message: 'Verification email sent. Check your inbox.' })
  })

  // POST /auth/login — 10/min/IP keeps online password guessing impractical
  // while never bothering a real coach with a forgotten password.
  app.post('/login', limit(10, '1 minute'), async (request, reply) => {
    const input = LoginSchema.parse(request.body)
    const user = await validateCredentials(input)
    if (!user) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid email or password' })
    }
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: '15m' })
    const refreshToken = app.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: '30d' })
    await saveRefreshToken(user.id, refreshToken)
    return reply.send({ user: { id: user.id, name: user.name, surname: user.surname, email: user.email }, accessToken, refreshToken })
  })

  // POST /auth/refresh
  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = RefreshSchema.parse(request.body)
    let payload: { sub?: number; type?: string }
    try {
      payload = app.jwt.verify(refreshToken)
    } catch {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid refresh token' })
    }
    // Only tokens minted AS refresh tokens may refresh — an access or
    // email-verification JWT must never be accepted here, even though the DB
    // lookup below would also reject it (defence in depth).
    if (payload.type !== 'refresh') {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid refresh token' })
    }
    const stored = await findRefreshToken(refreshToken)
    if (!stored || stored.expiresAt < new Date()) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Refresh token expired or not found' })
    }
    const newAccess = app.jwt.sign({ sub: stored.userId, email: stored.user.email }, { expiresIn: '15m' })
    const newRefresh = app.jwt.sign({ sub: stored.userId, type: 'refresh' }, { expiresIn: '30d' })
    await rotateRefreshToken(refreshToken, stored.userId, newRefresh)
    return reply.send({ accessToken: newAccess, refreshToken: newRefresh })
  })

  // POST /auth/logout
  app.post('/logout', async (request, reply) => {
    const { refreshToken } = RefreshSchema.parse(request.body)
    await revokeRefreshToken(refreshToken)
    return reply.send({ message: 'Logged out' })
  })

  // POST /auth/forgot-password — email a reset link. Always returns the same
  // generic 200 (whether or not the email is registered) to prevent enumeration.
  app.post('/forgot-password', limit(5, '15 minutes'), async (request, reply) => {
    const { email } = ForgotPasswordSchema.parse(request.body)
    const generic = { message: 'If that email is registered, a reset link is on its way.' }

    const issued = await createPasswordResetToken(email)
    if (issued) {
      const link = `${env.FRONTEND_URL}/reset-password?token=${issued.token}`
      if (isMailConfigured()) {
        try {
          await sendMail({
            to: issued.user.email,
            subject: 'Reset your TactiCoach password',
            text: `Hi ${issued.user.name},\n\nReset your password using this link (valid for 1 hour):\n${link}\n\nIf you didn't request this, you can safely ignore this email.`,
            html: `<p>Hi ${issued.user.name},</p><p>Reset your password using the button below (valid for 1 hour):</p><p><a href="${link}" style="display:inline-block;padding:11px 22px;border-radius:8px;background:#00A76F;color:#fff;text-decoration:none;font-weight:600">Reset password</a></p><p>Or paste this link into your browser:<br>${link}</p><p>If you didn't request this, you can safely ignore this email.</p>`,
          })
        } catch (err) {
          request.log.error({ err }, 'Failed to send password reset email')
        }
      } else if (env.NODE_ENV !== 'production') {
        // No SMTP configured — log the link so the flow is still testable in
        // dev. NEVER in production: a reset link in log output is a credential.
        request.log.warn(`SMTP not configured. Password reset link for ${email}: ${link}`)
      }
    }
    return reply.send(generic)
  })

  // POST /auth/reset-password — consume a token and set a new password.
  app.post('/reset-password', limit(10, '15 minutes'), async (request, reply) => {
    const { token, password } = ResetPasswordSchema.parse(request.body)
    const ok = await resetPasswordWithToken(token, password)
    if (!ok) {
      return reply
        .status(400)
        .send({ statusCode: 400, error: 'Bad Request', message: 'This reset link is invalid or has expired.' })
    }
    return reply.send({ message: 'Password updated. You can now sign in.' })
  })
}
