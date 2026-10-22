// ONBOARDING-EMAIL (20 Oct 2026) · Admin → Users: get invited coaches in.
//
//   GET  /admin/onboarding/pending        — who is waiting: invited but never
//        set a password, signed up but never confirmed their email
//   POST /admin/onboarding/resend          — resend to all of them (or the ids
//        given): invited → a fresh set-password link (and the reminder clock
//        restarts); signed up → a fresh confirm-email link. In each coach's
//        own language. Capped per call: the free email plan sends 300 a day.
//   POST /admin/users/:id/welcome          — the personal "we'll show you
//        round" message, from the team address, signed by the admin, with the
//        60-second video (WELCOME_VIDEO_URL) and, if they haven't set a
//        password yet, a fresh setup link.
//
// Registered inside adminRoutes, so authGuard + requireOwner already apply.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../config/database.js'
import { env } from '../../config/env.js'
import { isMailConfigured } from '../../config/mailer.js'
import { sendAccountSetupEmail, sendPersonalWelcomeEmail, sendVerificationEmail } from '../../lib/emails.js'
import { createAccountSetupToken } from '../auth/auth.service.js'

/** At most this many emails per bulk call (Brevo's free plan: 300 a day). */
export const BULK_RESEND_MAX = 100

const WAITING = { emailVerifiedAt: null, accountType: { in: ['coach', 'club'] as ('coach' | 'club')[] } }

export async function onboardingRoutes(app: FastifyInstance) {
  app.get('/onboarding/pending', async (_request, reply) => {
    const [invited, unconfirmed] = await Promise.all([
      db.user.count({ where: { ...WAITING, setupInvitedAt: { not: null } } }),
      db.user.count({ where: { ...WAITING, setupInvitedAt: null } }),
    ])
    return reply.send({ invited, unconfirmed, total: invited + unconfirmed, max: BULK_RESEND_MAX, mailConfigured: isMailConfigured() })
  })

  app.post('/onboarding/resend', async (request, reply) => {
    const { userIds } = z.object({ userIds: z.array(z.number().int().positive()).max(BULK_RESEND_MAX).optional() }).parse(request.body ?? {})
    const actorId = (request.user as { sub?: number } | undefined)?.sub
    const users = await db.user.findMany({
      where: { ...WAITING, ...(userIds ? { id: { in: userIds } } : {}) },
      select: { id: true, name: true, email: true, locale: true, setupInvitedAt: true },
      orderBy: { createdAt: 'desc' },
      take: BULK_RESEND_MAX,
    })
    let setup = 0
    let verify = 0
    for (const u of users) {
      if (u.setupInvitedAt) {
        const token = await createAccountSetupToken(u.id)
        await sendAccountSetupEmail(u, `${env.FRONTEND_URL}/reset-password?token=${token}`, actorId)
        await db.user.update({ where: { id: u.id }, data: { setupInvitedAt: new Date(), setupRemindersSent: 0 } })
        setup++
      } else {
        const token = app.jwt.sign({ sub: u.id, email: u.email, type: 'verify-email' }, { expiresIn: '24h' })
        await sendVerificationEmail(u, `${env.FRONTEND_URL}/verify-email?token=${token}`)
        verify++
      }
    }
    return reply.send({ setup, verify, sent: setup + verify, mailConfigured: isMailConfigured() })
  })

  app.post('/users/:id/welcome', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const actorId = (request.user as { sub?: number } | undefined)?.sub
    const [user, admin] = await Promise.all([
      db.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, locale: true, accountType: true, emailVerifiedAt: true, setupInvitedAt: true } }),
      actorId ? db.user.findUnique({ where: { id: actorId }, select: { name: true } }) : null,
    ])
    if (!user) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })
    if (user.accountType !== 'coach' && user.accountType !== 'club') {
      return reply.status(409).send({ statusCode: 409, error: 'not_a_coach', message: 'The personal welcome is for coach and club accounts.' })
    }
    // Not in yet: the message carries a fresh set-password link (and that is a new invitation).
    let setupUrl: string | null = null
    if (!user.emailVerifiedAt && user.setupInvitedAt) {
      setupUrl = `${env.FRONTEND_URL}/reset-password?token=${await createAccountSetupToken(user.id)}`
    }
    await sendPersonalWelcomeEmail(user, { senderName: admin?.name ?? 'TactiCoach', setupUrl, videoUrl: env.WELCOME_VIDEO_URL ?? null, actorId })
    await db.user.update({
      where: { id },
      data: { welcomedAt: new Date(), ...(setupUrl ? { setupInvitedAt: new Date(), setupRemindersSent: 0 } : {}) },
    })
    return reply.send({ sent: true, withSetupLink: !!setupUrl, withVideo: !!env.WELCOME_VIDEO_URL, mailConfigured: isMailConfigured() })
  })
}
