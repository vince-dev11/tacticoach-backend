import { forgetGate } from '../../lib/email-verify-gate.js'
import { randomUUID } from 'node:crypto'
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
import { isMailConfigured } from '../../config/mailer.js'
import { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail, sendActivatedWelcomeEmail } from '../../lib/emails.js'
import { authGuard } from '../../middleware/auth-guard.js'
import { getUserProfile } from '../users/users.service.js'
import { db } from '../../config/database.js'
import { FamilyError, inviteParentForSignup, loginRefusal, signupAge, type SignupAge } from '../family/family.service.js'

/**
 * Per-route rate limits, tighter than the global 100/min: these endpoints are
 * unauthenticated and guard credentials (brute force) or send email (spam).
 * Relaxed under test so suites can hammer them.
 */
// Outside production the limits are 50× looser: a local end-to-end run
// registers dozens of accounts an hour and locked itself out for 48 minutes
// (1 Oct). Production keeps the real numbers.
const limit = (max: number, timeWindow: string) => ({
  config: { rateLimit: { max: env.NODE_ENV === 'test' ? 10_000 : env.NODE_ENV === 'production' ? max : max * 50, timeWindow } },
})

/**
 * Failed-login throttle PER ACCOUNT, on top of the per-IP limit. Ten wrong
 * passwords for one email lock that email for a while; a clubhouse or school
 * on one connection no longer locks everyone out because a colleague
 * mistyped (QA B-10 — the IP limit is now looser and this is the brute-force
 * guard). In memory: fine for one API process, and a restart simply forgives.
 */
const LOGIN_FAILS_MAX = 10
const LOGIN_FAILS_WINDOW_MS = 15 * 60 * 1000
const loginFails = new Map<string, { count: number; until: number }>()
function loginLocked(email: string): boolean {
  const f = loginFails.get(email)
  if (!f) return false
  if (Date.now() > f.until) {
    loginFails.delete(email)
    return false
  }
  return f.count >= LOGIN_FAILS_MAX
}
function noteLoginFail(email: string): void {
  const now = Date.now()
  const f = loginFails.get(email)
  if (!f || now > f.until) loginFails.set(email, { count: 1, until: now + LOGIN_FAILS_WINDOW_MS })
  else f.count += 1
}
/** Test hook: forget every lock. */
export function resetLoginThrottle(): void {
  loginFails.clear()
}

export async function authRoutes(app: FastifyInstance) {
  /**
   * Token minting, in one place.
   *
   * Lifetimes come from config (they were hardcoded here, so the
   * JWT_*_EXPIRES_IN env vars silently did nothing and any attempt to shorten
   * a session by changing config had no effect). Refresh tokens are signed
   * with the separate refresh secret — see the namespace registered in app.ts.
   */
  const signAccess = (userId: number, email: string) =>
    app.jwt.sign({ sub: userId, email }, { expiresIn: env.JWT_ACCESS_EXPIRES_IN })
  // `jti` makes every refresh token distinct. Without it, two tokens minted
  // for the same user in the same second (register, then log in) were
  // byte-identical, and the second insert hit the unique index → 500.
  const signRefresh = (userId: number) =>
    app.jwt.refresh.sign({ sub: userId, type: 'refresh', jti: randomUUID() }, { expiresIn: env.JWT_REFRESH_EXPIRES_IN })

  /** Stateless email-verification link: a 24h signed JWT, no DB table needed. */
  const verifyUrlFor = (userId: number, email: string) => {
    const token = app.jwt.sign({ sub: userId, email, type: 'verify-email' }, { expiresIn: '24h' })
    return `${env.FRONTEND_URL}/verify-email?token=${token}`
  }

  // POST /auth/register
  app.post('/register', limit(20, '1 hour'), async (request, reply) => {
    const input = RegisterSchema.parse(request.body)
    // FAMILY-SIGNUP (12 Oct 2026): a player signs up with their date of birth
    // and a tick confirming it. Under 13: no account — a parent signs up and
    // adds them. 13–17: the account is made but works only once the parent
    // they named says yes (no tokens here). 18+: an ordinary account.
    let age: SignupAge | null = null
    // Same shape as the zod handler: { message, issues: { field: [message] } }.
    const bad = (issues: Record<string, string>) => reply.status(422).send({
      statusCode: 422, error: 'Validation Error', message: Object.values(issues)[0],
      issues: Object.fromEntries(Object.entries(issues).map(([k, v]) => [k, [v]])),
    })
    if (input.accountType === 'player') {
      const missing: Record<string, string> = {}
      if (!input.dateOfBirth) missing.dateOfBirth = 'Enter your date of birth'
      if (input.confirmAge !== true) missing.confirmAge = 'Confirm your date of birth is correct'
      if (Object.keys(missing).length) return bad(missing)
      try { age = signupAge(input.dateOfBirth!) } catch (err) {
        if (err instanceof FamilyError) return bad({ dateOfBirth: err.message })
        throw err
      }
      if (age.kind === 'under13') {
        return reply.status(403).send({ statusCode: 403, error: 'under_13', message: 'Under 13s can\'t have their own account. Ask your parent or guardian to sign up as a parent — they can add you.' })
      }
      if (age.kind === 'minor' && !input.parent) return bad({ parent: 'Enter your parent or guardian\'s name and email: they need to say yes.' })
      if (age.kind === 'minor' && input.parent!.email.trim().toLowerCase() === input.email.trim().toLowerCase()) {
        return bad({ 'parent.email': 'Your parent needs their own email, not yours.' })
      }
    }
    const user = await registerUser(input, { dateOfBirth: age && 'dob' in age ? age.dob : null })
    if (age?.kind === 'minor') {
      try {
        const { parentEmail } = await inviteParentForSignup(user, input.parent!)
        void sendWelcomeEmail(user, verifyUrlFor(user.id, user.email))
        // No tokens: login is refused until the parent says yes (loginRefusal).
        return reply.status(201).send({ awaitingParent: true, parentEmail })
      } catch (err) {
        // The parent can't be asked (their email is a player's): undo, so the
        // child can try again with the right address.
        await db.user.delete({ where: { id: user.id } }).catch(() => {})
        if (err instanceof FamilyError) return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.code, message: err.message, issues: { 'parent.email': [err.message] } })
        throw err
      }
    }
    const accessToken = signAccess(user.id, user.email)
    const refreshToken = signRefresh(user.id)
    await saveRefreshToken(user.id, refreshToken)
    // Fire-and-forget: the welcome email must never delay or fail a signup.
    void sendWelcomeEmail(user, verifyUrlFor(user.id, user.email))
    // Same shape as GET /users/me — see the note on /login below.
    return reply.status(201).send({ user: await getUserProfile(user.id), accessToken, refreshToken })
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
    forgetGate(payload.sub) // VERIFY-GATE: unlocked at once, not after the cache's 30 s
    return reply.send({ message: 'Email verified. Thanks!' })
  })

  // POST /auth/resend-verification — logged-in users can request a fresh link.
  app.post('/resend-verification', { preHandler: authGuard, ...limit(5, '15 minutes') }, async (request, reply) => {
    const userId = (request.user as { sub: number }).sub
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, emailVerifiedAt: true, locale: true },
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
  app.post('/login', limit(30, '1 minute'), async (request, reply) => {
    const input = LoginSchema.parse(request.body)
    const key = input.email.trim().toLowerCase()
    if (loginLocked(key)) {
      return reply.status(429).send({ statusCode: 429, error: 'Too Many Requests', message: 'Too many failed logins for this account. Try again in 15 minutes, or reset your password.' })
    }
    const user = await validateCredentials(input)
    if (!user) {
      noteLoginFail(key)
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid email or password' })
    }
    loginFails.delete(key)
    // FAMILY: an under-13 has no login; a 13–17 waits for their parent's yes.
    const refusal = await loginRefusal(user)
    if (refusal) return reply.status(403).send({ statusCode: 403, error: refusal.code, message: refusal.message })
    const accessToken = signAccess(user.id, user.email)
    const refreshToken = signRefresh(user.id)
    await saveRefreshToken(user.id, refreshToken)
    // The SAME payload as GET /users/me, not a hand-picked subset.
    //
    // This used to send five fields, so everything else — `role` above all —
    // arrived undefined and stayed that way until the next full page load.
    // Log in as the owner and the Admin link was missing until you refreshed;
    // the app had simply never been told. Any field the client reads outside
    // that subset had the same bug waiting in it, which is why the fix is one
    // shared shape rather than adding `role` to the list.
    return reply.send({ user: await getUserProfile(user.id), accessToken, refreshToken })
  })

  // POST /auth/refresh
  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = RefreshSchema.parse(request.body)
    let payload: { sub?: number; type?: string }
    try {
      payload = app.jwt.refresh.verify(refreshToken)
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
    // FAMILY: the same rule on every refresh — a parent closing or not yet
    // approving a child's account must not be outlived by a session.
    if (await loginRefusal(stored.user)) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Refresh token expired or not found' })
    }
    const newAccess = signAccess(stored.userId, stored.user.email)
    const newRefresh = signRefresh(stored.userId)
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
        // Branded template — same layout as every other TactiCoach email.
        await sendPasswordResetEmail(issued.user, link)
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
    // ONBOARDING-EMAIL: an invited coach has just set their password — their
    // welcome, in their language, with the first five minutes spelled out.
    if (ok.firstActivation) {
      const u = await db.user.findUnique({ where: { id: ok.userId }, select: { id: true, name: true, email: true, locale: true, accountType: true } })
      if (u && (u.accountType === 'coach' || u.accountType === 'club')) void sendActivatedWelcomeEmail(u)
    }
    return reply.send({ message: 'Password updated. You can now sign in.' })
  })
}
