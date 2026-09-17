// Owner-only admin API — blog CMS + CRM. Everything here sits behind
// authGuard + requireOwner (role checked against the DB per request).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireOwner } from '../../middleware/owner-guard.js'
import { db } from '../../config/database.js'
import { uploadToS3, deleteFromS3, presignUrl } from '../../config/s3.js'
import { readUpload } from '../../lib/multipart.js'
import { presignUrl as presign } from '../../config/s3.js'
import { env } from '../../config/env.js'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import {
  sendClubPageApprovedEmail, sendClubPageRejectedEmail, sendAccountSetupEmail,
  sendPasswordResetEmail,
} from '../../lib/emails.js'
import { isMailConfigured } from '../../config/mailer.js'
import { createAccountSetupToken, createPasswordResetTokenFor } from '../auth/auth.service.js'
import { latinOnly } from '../../lib/latin-only.js'
import { invitePartner, endPartner } from '../partners/partners.service.js'
import { sendPartnerInviteEmail } from '../../lib/emails.js'

// ---- TEMPORARY: remove once `prisma generate` has run against migration 23 --
// The generated client has no `emailLog` delegate until then. Narrow on
// purpose so it cannot mask a mistake elsewhere in this file.
interface EmailLogRow {
  id: number
  to: string
  kind: string
  subject: string
  status: string
  error: string | null
  createdAt: Date
}
const emailLogDb = () =>
  (db as unknown as {
    emailLog: { findMany(args: unknown): Promise<EmailLogRow[]> }
  }).emailLog

// ---- TEMPORARY: remove once `prisma generate` has run against migration 24 --
// Same situation one migration later: the generated ContactMessage type has no
// `source`, `kind` or `note` yet, and `message` is still non-nullable there.
//
// Narrow on purpose: only the calls that touch the new columns go through it.
// `db.contactMessage.count()` and the delete still use the real client, so a
// genuine mistake in those still fails the build.
interface LeadRow {
  id: number
  firstName: string
  lastName: string
  email: string
  source: 'web' | 'direct' | 'import'
  kind: 'unknown' | 'coach' | 'club'
  message: string | null
  note: string | null
  status: 'new' | 'replied' | 'closed'
  createdAt: Date
  updatedAt: Date
}
const leadDb = () =>
  (db as unknown as {
    contactMessage: {
      findMany(args?: unknown): Promise<LeadRow[]>
      findFirst(args?: unknown): Promise<LeadRow | null>
      create(args: unknown): Promise<LeadRow>
      createMany(args: unknown): Promise<{ count: number }>
      update(args: unknown): Promise<LeadRow>
      groupBy(args: unknown): Promise<{ _count: { _all: number } }[]>
    }
  }).contactMessage

// ---- Schemas -----------------------------------------------------------------

const PostSchema = z.object({
  title: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only')
    .optional(),
  excerpt: z.string().max(500).optional().nullable(),
  content: z.string().max(200_000).default(''),
  tags: z.array(z.string().max(40)).max(10).default([]),
  status: z.enum(['draft', 'published']).default('draft'),
  seoTitle: z.string().max(255).optional().nullable(),
  seoDescription: z.string().max(320).optional().nullable(),
})

const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const COVER_MAX = 3 * 1024 * 1024 // 3 MB

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 180) || 'post'
  )
}

async function uniqueSlug(base: string, excludeId?: number): Promise<string> {
  let slug = base
  for (let i = 2; ; i++) {
    const clash = await db.blogPost.findFirst({
      where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    })
    if (!clash) return slug
    slug = `${base}-${i}`
  }
}

const readMinutes = (content: string) =>
  Math.max(1, Math.round(content.split(/\s+/).filter(Boolean).length / 200))

async function withCover<T extends { coverImageKey: string | null }>(post: T) {
  return { ...post, coverUrl: post.coverImageKey ? await presignUrl(post.coverImageKey) : null }
}

// ---- Routes ------------------------------------------------------------------

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard)
  app.addHook('preHandler', requireOwner)

  // ===== Blog CMS ===============================================================

  // GET /admin/blog — every post, drafts included
  app.get('/blog', async (_request, reply) => {
    const posts = await db.blogPost.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, slug: true, title: true, excerpt: true, status: true,
        publishedAt: true, updatedAt: true, tags: true, coverImageKey: true,
      },
    })
    return reply.send(await Promise.all(posts.map(withCover)))
  })

  // GET /admin/blog/:id — full post for editing
  app.get('/blog/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const post = await db.blogPost.findUnique({ where: { id } })
    if (!post) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Post not found' })
    return reply.send(await withCover(post))
  })

  // POST /admin/blog — create (draft by default)
  app.post('/blog', async (request, reply) => {
    const userId = (request.user as { sub: number }).sub
    const input = PostSchema.parse(request.body)
    const slug = await uniqueSlug(input.slug ?? slugify(input.title))
    const post = await db.blogPost.create({
      data: {
        title: input.title,
        slug,
        excerpt: input.excerpt ?? null,
        content: input.content,
        tags: input.tags as Prisma.InputJsonValue,
        status: input.status,
        publishedAt: input.status === 'published' ? new Date() : null,
        seoTitle: input.seoTitle ?? null,
        seoDescription: input.seoDescription ?? null,
        readMinutes: readMinutes(input.content),
        authorId: userId,
      },
    })
    return reply.status(201).send(await withCover(post))
  })

  // PATCH /admin/blog/:id — update; stamps publishedAt on first publish
  app.patch('/blog/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const existing = await db.blogPost.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Post not found' })

    const input = PostSchema.partial().parse(request.body)
    const post = await db.blogPost.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.slug !== undefined && { slug: await uniqueSlug(input.slug, id) }),
        ...(input.excerpt !== undefined && { excerpt: input.excerpt }),
        ...(input.content !== undefined && {
          content: input.content,
          readMinutes: readMinutes(input.content),
        }),
        ...(input.tags !== undefined && { tags: input.tags as Prisma.InputJsonValue }),
        ...(input.seoTitle !== undefined && { seoTitle: input.seoTitle }),
        ...(input.seoDescription !== undefined && { seoDescription: input.seoDescription }),
        ...(input.status !== undefined && {
          status: input.status,
          publishedAt:
            input.status === 'published' ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
        }),
      },
    })
    return reply.send(await withCover(post))
  })

  // POST /admin/blog/:id/cover — cover image upload
  app.post('/blog/:id/cover', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const post = await db.blogPost.findUnique({ where: { id }, select: { id: true, coverImageKey: true } })
    if (!post) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Post not found' })

    const file = await readUpload(request, { maxBytes: COVER_MAX, allowedTypes: COVER_TYPES })
    if (post.coverImageKey) await deleteFromS3(post.coverImageKey).catch(() => {})
    const ext = file.mimetype === 'image/webp' ? 'webp' : file.mimetype === 'image/png' ? 'png' : 'jpg'
    const key = `blog/${id}/cover-${Date.now()}.${ext}`
    await uploadToS3(key, file.buffer, file.mimetype)
    await db.blogPost.update({ where: { id }, data: { coverImageKey: key } })
    return reply.send({ coverUrl: await presignUrl(key) })
  })

  // DELETE /admin/blog/:id
  app.delete('/blog/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const post = await db.blogPost.findUnique({ where: { id }, select: { coverImageKey: true } })
    if (!post) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Post not found' })
    if (post.coverImageKey) await deleteFromS3(post.coverImageKey).catch(() => {})
    await db.blogPost.delete({ where: { id } })
    return reply.status(204).send()
  })

  // ===== CRM ====================================================================

  // GET /admin/stats — overview dashboard numbers
  app.get('/stats', async (_request, reply) => {
    const now = new Date()
    const in7d = new Date(now.getTime() + 7 * 86400_000)
    const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * 86400_000)

    const [totalUsers, verifiedUsers, activeTrials, expiringTrials, paidSubs, newLeads, recentUsers] =
      await Promise.all([
        db.user.count(),
        db.user.count({ where: { emailVerifiedAt: { not: null } } }),
        db.userSubscription.count({ where: { status: 'trial', expiresAt: { gt: now } } }),
        db.userSubscription.count({ where: { status: 'trial', expiresAt: { gt: now, lte: in7d } } }),
        db.userSubscription.findMany({
          where: { status: 'active', paymentProvider: 'stripe' },
          include: { plan: { select: { monthlyPrice: true, annualPrice: true } } },
        }),
        db.contactMessage.count({ where: { status: 'new' } }),
        db.user.findMany({
          where: { createdAt: { gte: eightWeeksAgo } },
          select: { createdAt: true },
        }),
      ])

    // Estimated MRR from active Stripe subscriptions.
    let mrr = 0
    for (const sub of paidSubs) {
      if (sub.billingCycle === 'annual' && sub.plan.annualPrice) mrr += Number(sub.plan.annualPrice) / 12
      else if (sub.plan.monthlyPrice) mrr += Number(sub.plan.monthlyPrice)
    }

    // Signups per ISO week (last 8 weeks), oldest first.
    const weeks: { week: string; count: number }[] = []
    for (let i = 7; i >= 0; i--) {
      const start = new Date(now.getTime() - (i + 1) * 7 * 86400_000)
      const end = new Date(now.getTime() - i * 7 * 86400_000)
      weeks.push({
        week: end.toISOString().slice(0, 10),
        count: recentUsers.filter((u) => u.createdAt >= start && u.createdAt < end).length,
      })
    }

    return reply.send({
      totalUsers,
      verifiedUsers,
      activeTrials,
      expiringTrials,
      payingSubscribers: paidSubs.length,
      mrr: Math.round(mrr * 100) / 100,
      newLeads,
      signupsByWeek: weeks,
    })
  })

  // GET /admin/users?search=&page= — customer list
  app.get('/users', async (request, reply) => {
    const { search = '', page = '1' } = request.query as Record<string, string>
    const take = 25
    const skip = (Math.max(1, Number(page) || 1) - 1) * take
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { email: { contains: search } },
            { name: { contains: search } },
            { surname: { contains: search } },
            { clubName: { contains: search } },
          ],
        }
      : {}
    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true, name: true, surname: true, email: true, clubName: true,
          emailVerifiedAt: true, createdAt: true, role: true, accountType: true,
          // The derived reality next to the declared type: someone who picked
          // "club" at signup and never took the plan has no Club row, which
          // makes them a sales lead rather than a club.
          ownedClub: { select: { id: true } },
          subscription: { select: { status: true, expiresAt: true, paymentProvider: true, plan: { select: { name: true, slug: true } } } },
          _count: { select: { boards: true, drillSheets: true } },
        },
      }),
      db.user.count({ where }),
    ])
    return reply.send({ users, total, page: Number(page) || 1, limit: take })
  })

  /**
   * Put a complimentary subscription on an account, replacing whatever was
   * there (trial, paid, nothing). No Stripe involved. `months` null = no
   * expiry. Granting the Club plan also creates the Club so seats can be
   * invited straight away, exactly as a paid activation does.
   *
   * Shared by "give plan" on an existing user and by the create-user route, so
   * an account made by an admin lands in precisely the same state as one that
   * was upgraded by hand afterwards.
   */
  async function grantPlan(
    userId: number,
    plan: { id: number; slug: string; name: string },
    months: number | null,
    user: { name: string; clubName: string | null },
  ) {
    const expiresAt = months ? new Date(new Date().setMonth(new Date().getMonth() + months)) : null
    const data = {
      planId: plan.id,
      status: 'active' as const,
      billingCycle: null,
      startedAt: new Date(),
      expiresAt,
      cancelledAt: null,
      trialReminderSentAt: null,
      paymentProvider: 'complimentary',
      providerSubscriptionId: null,
    }
    const sub = await db.userSubscription.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    })
    if (plan.slug === 'club') {
      await db.club.upsert({
        where: { ownerId: userId },
        update: {},
        create: { ownerId: userId, name: user.clubName || `${user.name}'s Club` },
      })
    }
    return sub
  }

  // POST /admin/users — create an account on someone's behalf.
  //
  // For comping a partner, setting a club up on a call, or migrating a coach
  // across. Deliberately NO password field: the account is created with a
  // random hash nobody has ever seen, and the person chooses their own via a
  // set-password link. An admin who can type a customer's password is an admin
  // who knows it, which is not a thing we want to be true when a club asks.
  app.post('/users', async (request, reply) => {
    const input = z
      .object({
        name: latinOnly(z.string().min(1).max(100)),
        surname: latinOnly(z.string().min(1).max(100)),
        email: z.string().email().max(191),
        accountType: z.enum(['coach', 'club', 'player']).default('coach'),
        clubName: latinOnly(z.string().max(150)).optional().nullable(),
        /// Grant a plan immediately. Omit for an account with no access yet.
        planSlug: z.string().min(1).max(50).optional().nullable(),
        /// null with a planSlug = comped forever.
        months: z.number().int().min(1).max(120).optional().nullable(),
        /// Send the set-password email. False = the admin passes the returned
        /// link on themselves (on a call, in a DM).
        sendEmail: z.boolean().default(true),
      })
      .parse(request.body)

    const email = input.email.trim().toLowerCase()
    if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
      return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'That email already has an account' })
    }

    const plan = input.planSlug
      ? await db.membershipPlan.findUnique({ where: { slug: input.planSlug }, select: { id: true, slug: true, name: true } })
      : null
    if (input.planSlug && !plan) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Plan not found' })
    }

    const user = await db.user.create({
      data: {
        name: input.name,
        surname: input.surname,
        email,
        accountType: input.accountType,
        clubName: input.clubName ?? null,
        // Unguessable and never transmitted: the only way in is the setup link.
        passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12),
        // The admin typed this address on purpose, and the setup link proves
        // the mailbox anyway — nobody can sign in without receiving it.
        emailVerifiedAt: new Date(),
      },
      select: { id: true, name: true, surname: true, email: true, accountType: true, clubName: true },
    })

    if (plan) await grantPlan(user.id, plan, input.months ?? null, user)

    const token = await createAccountSetupToken(user.id)
    const setupUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`
    if (input.sendEmail) void sendAccountSetupEmail(user, setupUrl)

    // The link comes back either way: email is slow, lands in spam, or the
    // admin is on a call with the person right now.
    return reply.status(201).send({ user, setupUrl, emailSent: input.sendEmail })
  })

  // PATCH /admin/users/:id/email { email } — correct a typo'd address.
  //
  // Email IS the login identity here, so this is not an ordinary field edit.
  // Two things must happen with it, or the account is left in a state nobody
  // would predict:
  //
  //   - outstanding password-reset / set-password tokens are voided. They were
  //     issued to reach the OLD address; whoever holds that inbox must not be
  //     able to finish setting a password on this account.
  //   - the address is unverified again. It has never been proven.
  //
  // Live sessions are deliberately NOT killed: the person may be mid-task and
  // the change is usually an admin fixing a typo on their behalf.
  app.patch('/users/:id/email', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const { email } = z.object({ email: z.string().trim().email().max(191) }).parse(request.body)
    const next = email.toLowerCase()

    const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true } })
    if (!user) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })
    }
    if (user.email.toLowerCase() === next) {
      return reply.send({ id, email: next, unchanged: true })
    }

    const clash = await db.user.findUnique({ where: { email: next }, select: { id: true } })
    if (clash) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'Another account already uses that email',
      })
    }

    const [updated] = await db.$transaction([
      db.user.update({
        where: { id },
        data: { email: next, emailVerifiedAt: null },
        select: { id: true, name: true, surname: true, email: true },
      }),
      // Anything already issued pointed at the old inbox.
      db.passwordResetToken.deleteMany({ where: { userId: id, usedAt: null } }),
    ])
    return reply.send(updated)
  })

  // POST /admin/users/:id/email/:kind — send this user a mail, now.
  //
  // `setup` mints a FRESH token rather than resending the old one: the old one
  // may have expired, and a link that looks resent but is already dead is
  // worse than no link. The URL comes back either way, so an admin on a call
  // can read it out.
  app.post('/users/:id/email/:kind', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const { kind } = z
      .object({ kind: z.enum(['setup', 'reset']) })
      .parse(request.params)

    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, surname: true, email: true },
    })
    if (!user) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })
    }

    const actorId = (request.user as { sub?: number } | undefined)?.sub
    const token =
      kind === 'setup'
        ? await createAccountSetupToken(user.id)
        : await createPasswordResetTokenFor(user.id)
    const url = `${env.FRONTEND_URL}/reset-password?token=${token}`

    // Awaited, not fire-and-forget: the admin is watching, and "sent" needs to
    // mean it. sendSafely swallows provider failures, and the email_log row
    // records which of the two it was.
    if (kind === 'setup') await sendAccountSetupEmail(user, url, actorId)
    else await sendPasswordResetEmail(user, url, actorId)

    return reply.send({ sent: true, url, mailConfigured: isMailConfigured() })
  })

  // GET /admin/users/:id/emails — what this account has been sent.
  app.get('/users/:id/emails', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const rows = await emailLogDb().findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, to: true, kind: true, subject: true,
        status: true, error: true, createdAt: true,
      },
    })
    return reply.send(rows)
  })

  // PATCH /admin/users/:id/trial { days } — extend (or start) a trial
  app.patch('/users/:id/trial', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const { days } = z.object({ days: z.number().int().min(1).max(90) }).parse(request.body)

    const sub = await db.userSubscription.findUnique({ where: { userId: id } })
    if (!sub) {
      const trialPlan = await db.membershipPlan.findUnique({ where: { slug: 'pro-ai' } })
      if (!trialPlan) {
        return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'Trial plan not seeded' })
      }
      const created = await db.userSubscription.create({
        data: {
          userId: id,
          planId: trialPlan.id,
          status: 'trial',
          expiresAt: new Date(Date.now() + days * 86400_000),
        },
      })
      return reply.send(created)
    }

    const base = sub.expiresAt && sub.expiresAt > new Date() ? sub.expiresAt : new Date()
    const updated = await db.userSubscription.update({
      where: { userId: id },
      data: {
        status: 'trial',
        expiresAt: new Date(base.getTime() + days * 86400_000),
        // Re-arm the trial reminder for the new expiry window.
        trialReminderSentAt: null,
      },
    })
    return reply.send(updated)
  })

  // ===== Complimentary plans ===================================================

  // GET /admin/plans — the plans an owner can grant (active, in display order)
  app.get('/plans', async (_request, reply) => {
    const plans = await db.membershipPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, slug: true, monthlyPrice: true },
    })
    return reply.send({ plans })
  })

  // PATCH /admin/users/:id/plan { planSlug, months } — grant a complimentary
  // plan. Replaces whatever the user has (trial, paid, nothing) with an
  // active subscription on that plan, no Stripe involved. `months` null =
  // no expiry. Granting the Club plan also creates the user's Club so they
  // can invite seats, exactly as a paid activation does.
  app.patch('/users/:id/plan', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const { planSlug, months } = z
      .object({ planSlug: z.string().min(1).max(50), months: z.number().int().min(1).max(120).nullable() })
      .parse(request.body)

    const plan = await db.membershipPlan.findUnique({ where: { slug: planSlug }, select: { id: true, slug: true, name: true } })
    if (!plan) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Plan not found' })
    const user = await db.user.findUnique({ where: { id }, select: { id: true, name: true, clubName: true } })
    if (!user) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })

    return reply.send(await grantPlan(id, plan, months, user))
  })

  // DELETE /admin/users/:id/plan — revoke a complimentary plan (marks the
  // subscription expired; Stripe-managed subscriptions are left alone).
  app.delete('/users/:id/plan', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const sub = await db.userSubscription.findUnique({ where: { userId: id }, select: { paymentProvider: true } })
    if (!sub) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'No subscription' })
    if (sub.paymentProvider === 'stripe') {
      return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'This is a paid subscription — cancel it in Stripe' })
    }
    await db.userSubscription.update({ where: { userId: id }, data: { status: 'expired', expiresAt: new Date(), cancelledAt: new Date() } })
    return reply.status(204).send()
  })

  // ===== Club page approvals ====================================================

  // GET /admin/club-pages?status= — review queue (default: pending)
  app.get('/club-pages', async (request, reply) => {
    const { status = 'pending' } = request.query as Record<string, string>
    const where =
      status === 'all'
        ? { pageStatus: { not: 'none' as const } }
        : { pageStatus: (['pending', 'approved', 'rejected', 'suspended'].includes(status) ? status : 'pending') as 'pending' | 'approved' | 'rejected' | 'suspended' }
    const clubs = await db.club.findMany({
      where,
      orderBy: { pageSubmittedAt: 'desc' },
      include: {
        owner: { select: { id: true, name: true, surname: true, email: true } },
        members: { select: { userId: true } },
      },
    })
    const rows = await Promise.all(
      clubs.map(async (c) => {
        const coachIds = [c.ownerId, ...c.members.map((m) => m.userId)]
        const [boards, sheets] = await Promise.all([
          db.canvasBoard.count({ where: { userId: { in: coachIds }, published: true } }),
          db.drillSheet.count({ where: { userId: { in: coachIds }, published: true } }),
        ])
        return {
          id: c.id,
          name: c.name,
          slug: c.slug,
          bio: c.bio,
          badgeUrl: c.badgeKey ? await presign(c.badgeKey) : null,
          pageStatus: c.pageStatus,
          pageSubmittedAt: c.pageSubmittedAt,
          pageReviewNote: c.pageReviewNote,
          owner: c.owner,
          publishedBoards: boards,
          publishedSheets: sheets,
        }
      }),
    )
    return reply.send(rows)
  })

  // PATCH /admin/club-pages/:id { action, note? } — approve / reject / suspend
  app.patch('/club-pages/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const { action, note } = z
      .object({ action: z.enum(['approve', 'reject', 'suspend']), note: z.string().max(500).optional() })
      .parse(request.body)

    const club = await db.club.findUnique({
      where: { id },
      include: { owner: { select: { name: true, email: true } } },
    })
    if (!club) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Club not found' })
    if (action === 'reject' && !note) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'A note is required when rejecting — the owner needs to know why' })
    }

    const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'suspended'
    const updated = await db.club.update({
      where: { id },
      data: { pageStatus: status, pageReviewNote: note ?? null },
    })

    // Notify the owner (fire-and-forget).
    if (action === 'approve' && club.slug) {
      void sendClubPageApprovedEmail(club.owner, club.name, `${env.FRONTEND_URL}/club/${club.slug}`)
    } else if (action === 'reject') {
      void sendClubPageRejectedEmail(club.owner, club.name, note!)
    }

    return reply.send({ id: updated.id, pageStatus: updated.pageStatus })
  })

  // ---- Leads ----------------------------------------------------------------
  //
  // One list, three ways in: the website's contact form (source `web`), typed
  // in by an admin (`direct`), or a spreadsheet (`import`). See migration 24
  // for why this is one table rather than two.

  const LeadStatus = z.enum(['new', 'replied', 'closed'])
  const LeadSource = z.enum(['web', 'direct', 'import'])
  const LeadKind = z.enum(['unknown', 'coach', 'club'])

  /** One row as it arrives from a form or a spreadsheet, before it is trusted. */
  const LeadInput = z.object({
    firstName: latinOnly(z.string().min(1).max(100)),
    lastName: latinOnly(z.string().max(100)).default(''),
    // `.trim()` BEFORE `.email()`, which is not cosmetic: an address with a
    // trailing space fails email validation outright. Every address in this
    // feature is pasted from somewhere — a DM, a spreadsheet cell — and
    // rejecting "hiksel@hotmail.com " as malformed is both wrong and
    // impossible for the person to see.
    email: z.string().trim().toLowerCase().email().max(255),
    kind: LeadKind.default('unknown'),
    note: z.string().max(500).optional().nullable(),
  })

  // GET /admin/leads?status=&source=&kind=&q=
  app.get('/leads', async (request, reply) => {
    const { status, source, kind, q } = request.query as Record<string, string>
    const leads = await leadDb().findMany({
      where: {
        ...(LeadStatus.safeParse(status).success ? { status: status as 'new' } : {}),
        ...(LeadSource.safeParse(source).success ? { source: source as 'web' } : {}),
        ...(LeadKind.safeParse(kind).success ? { kind: kind as 'coach' } : {}),
        // Name or email. Trimmed, because a search box picks up stray spaces
        // and " " would otherwise match every row via contains.
        ...(q?.trim()
          ? {
              OR: [
                { email: { contains: q.trim() } },
                { firstName: { contains: q.trim() } },
                { lastName: { contains: q.trim() } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return reply.send(leads)
  })

  // GET /admin/leads/stats — the counts the list header shows.
  app.get('/leads/stats', async (_request, reply) => {
    const [total, bySource, byKind] = await Promise.all([
      db.contactMessage.count(),
      leadDb().groupBy({ by: ['source'], _count: { _all: true } }),
      leadDb().groupBy({ by: ['kind'], _count: { _all: true } }),
    ])
    const tally = (rows: { _count: { _all: number } }[], key: string) =>
      Object.fromEntries(
        (rows as unknown as Record<string, unknown>[]).map((r) => [r[key], (r._count as { _all: number })._all]),
      )
    return reply.send({ total, source: tally(bySource, 'source'), kind: tally(byKind, 'kind') })
  })

  // POST /admin/leads — add one by hand.
  app.post('/leads', async (request, reply) => {
    const input = LeadInput.parse(request.body)
    const email = input.email.trim().toLowerCase()

    // Warn rather than refuse. The same person legitimately appears twice —
    // they filled the form in March and you met them in September — and
    // throwing away the second record because of the first loses the newer,
    // better context. The response says so and the UI shows it.
    const existing = await leadDb().findFirst({
      where: { email },
      select: { id: true, source: true, createdAt: true },
    })

    const lead = await leadDb().create({
      data: {
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        email,
        source: 'direct',
        kind: input.kind,
        // Null, not ''. They have not written to us — see the schema comment.
        message: null,
        note: input.note?.trim() || null,
      },
    })
    return reply.status(201).send({ lead, duplicateOf: existing })
  })

  // POST /admin/leads/import { rows } — a spreadsheet, already parsed.
  //
  // The file is parsed in the BROWSER and posted as JSON. The alternative —
  // uploading .xlsx and parsing it here — means a spreadsheet parser running
  // on untrusted input inside the API process, which is a genuinely nasty
  // class of vulnerability for a feature used a handful of times a year.
  app.post('/leads/import', async (request, reply) => {
    const { rows } = z
      .object({
        // Capped. An import is a list a human assembled; anything larger is a
        // mistake, and the honest failure is "that file is too big" rather
        // than a request that times out half-applied.
        rows: z.array(z.unknown()).min(1).max(5000),
      })
      .parse(request.body)

    const seen = new Set<string>()
    const valid: { firstName: string; lastName: string; email: string; kind: 'unknown' | 'coach' | 'club'; note: string | null }[] = []
    const invalid: { row: number; reason: string }[] = []
    const duplicateInFile: string[] = []

    rows.forEach((raw, i) => {
      const parsed = LeadInput.safeParse(raw)
      if (!parsed.success) {
        // The spreadsheet row number the person is looking at: +2 for the
        // header row and for 1-based counting. Telling them "row 0" when
        // their screen says row 2 is how an import becomes unusable.
        invalid.push({ row: i + 2, reason: parsed.error.issues[0]?.message ?? 'invalid' })
        return
      }
      const email = parsed.data.email.trim().toLowerCase()
      if (seen.has(email)) {
        duplicateInFile.push(email)
        return
      }
      seen.add(email)
      valid.push({
        firstName: parsed.data.firstName.trim(),
        lastName: parsed.data.lastName.trim(),
        email,
        kind: parsed.data.kind,
        note: parsed.data.note?.trim() || null,
      })
    })

    // Already on file — skipped, and named so the person can see who.
    const existing = valid.length
      ? await leadDb().findMany({
          where: { email: { in: valid.map((v) => v.email) } },
          select: { email: true },
        })
      : []
    const known = new Set(existing.map((e) => e.email))
    const toCreate = valid.filter((v) => !known.has(v.email))

    if (toCreate.length > 0) {
      await leadDb().createMany({
        data: toCreate.map((v) => ({ ...v, source: 'import' as const, message: null })),
      })
    }

    // Every row is accounted for: imported + already on file + duplicated
    // inside the file + rejected == what they sent. An import that silently
    // drops rows is one nobody trusts twice.
    return reply.send({
      received: rows.length,
      imported: toCreate.length,
      alreadyOnFile: [...known],
      duplicateInFile,
      invalid,
    })
  })

  // PATCH /admin/leads/:id { status?, kind?, note? }
  app.patch('/leads/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const input = z
      .object({
        status: LeadStatus.optional(),
        kind: LeadKind.optional(),
        note: z.string().max(500).optional().nullable(),
      })
      .parse(request.body)
    if (Object.keys(input).length === 0) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'Nothing to change' })
    }
    const lead = await leadDb().update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      },
    })
    return reply.send(lead)
  })

  // DELETE /admin/leads/:id — for a typo'd import or a row added twice.
  app.delete('/leads/:id', async (request, reply) => {
    const { count } = await db.contactMessage.deleteMany({
      where: { id: Number((request.params as { id: string }).id) },
    })
    return count > 0
      ? reply.status(204).send()
      : reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Lead not found' })
  })

  // ---- Partner programme ----------------------------------------------------
  // Partners are invite-only by design (agreement §1), so there is no self-serve
  // route to become one — it happens here, after an agreement is signed.

  // GET /admin/partners — the roster with what each is owed.
  app.get('/partners', async (_request, reply) => {
    const partners = await db.partner.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, surname: true, email: true, referralCode: true } },
        commissions: { select: { commissionAmount: true, reversedAt: true, paidOutAt: true } },
      },
    })

    return reply.send(
      partners.map((p) => {
        const live = p.commissions.filter((c) => !c.reversedAt)
        return {
          id: p.id,
          status: p.status,
          commissionRate: Number(p.commissionRate),
          companyName: p.companyName,
          agreementSignedAt: p.agreementSignedAt,
          agreementVersion: p.agreementVersion,
          startedAt: p.startedAt,
          endedAt: p.endedAt,
          user: p.user,
          owedPence: live.filter((c) => !c.paidOutAt).reduce((s, c) => s + c.commissionAmount, 0),
          lifetimePence: live.reduce((s, c) => s + c.commissionAmount, 0),
        }
      }),
    )
  })

  // POST /admin/partners { email, commissionRate?, companyName?, notes? }
  // Sends the invitation. They are NOT a partner until they accept in the app.
  app.post('/partners', async (request, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        // Stored as a fraction: 0.2 is 20%. Capped at 100% so a typo of "20"
        // meaning percent cannot commit us to twenty times the revenue.
        commissionRate: z.number().min(0).max(1).optional(),
        companyName: z.string().max(150).optional(),
        notes: z.string().max(2000).optional(),
      })
      .parse(request.body)

    const user = await db.user.findUnique({ where: { email: body.email }, select: { id: true } })
    if (!user) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'No account with that email — the partner needs to sign up first',
      })
    }

    const { code } = await invitePartner({
      userId: user.id,
      commissionRate: body.commissionRate,
      companyName: body.companyName ?? null,
      notes: body.notes ?? null,
    })
    const invitee = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { name: true, email: true },
    })
    // Fire-and-forget: a mail outage must not make the invite look like it
    // failed when the partner row was created perfectly well.
    void sendPartnerInviteEmail(invitee, `${env.FRONTEND_URL}/profile#partner`)

    return reply.send({ userId: user.id, code, status: 'invited' })
  })

  // PATCH /admin/partners/:id { status?, commissionRate? }
  app.patch('/partners/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const body = z
      .object({
        status: z.enum(['invited', 'active', 'suspended', 'ended']).optional(),
        commissionRate: z.number().min(0).max(1).optional(),
      })
      .parse(request.body)

    const partner = await db.partner.findUnique({ where: { id }, select: { userId: true } })
    if (!partner) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Partner not found' })
    }

    if (body.status === 'ended') {
      await endPartner(partner.userId)
    } else if (body.status) {
      await db.partner.update({ where: { id }, data: { status: body.status, endedAt: null } })
    }
    // A rate change applies to referrals made after it (agreement §7); past
    // commission lines keep the rate copied onto them at the time.
    if (body.commissionRate !== undefined) {
      await db.partner.update({ where: { id }, data: { commissionRate: body.commissionRate } })
    }

    const updated = await db.partner.findUniqueOrThrow({ where: { id } })
    return reply.send({ id: updated.id, status: updated.status, commissionRate: Number(updated.commissionRate) })
  })

  // POST /admin/partners/:id/mark-paid — stamp the open lines as settled after
  // paying an invoice. Amounts are never edited, only marked.
  app.post('/partners/:id/mark-paid', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const result = await db.partnerCommission.updateMany({
      where: { partnerId: id, paidOutAt: null, reversedAt: null },
      data: { paidOutAt: new Date() },
    })
    return reply.send({ marked: result.count })
  })
}
