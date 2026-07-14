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
import { sendClubPageApprovedEmail, sendClubPageRejectedEmail } from '../../lib/emails.js'

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
          emailVerifiedAt: true, createdAt: true, role: true,
          subscription: { select: { status: true, expiresAt: true, plan: { select: { name: true, slug: true } } } },
          _count: { select: { boards: true, drillSheets: true } },
        },
      }),
      db.user.count({ where }),
    ])
    return reply.send({ users, total, page: Number(page) || 1, limit: take })
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
      void sendClubPageApprovedEmail(club.owner, club.name, `${env.FRONTEND_URL}/c/${club.slug}`)
    } else if (action === 'reject') {
      void sendClubPageRejectedEmail(club.owner, club.name, note!)
    }

    return reply.send({ id: updated.id, pageStatus: updated.pageStatus })
  })

  // GET /admin/leads — contact form inbox
  app.get('/leads', async (request, reply) => {
    const { status } = request.query as Record<string, string>
    const leads = await db.contactMessage.findMany({
      where: status && ['new', 'replied', 'closed'].includes(status) ? { status: status as 'new' | 'replied' | 'closed' } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return reply.send(leads)
  })

  // PATCH /admin/leads/:id { status }
  app.patch('/leads/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const { status } = z.object({ status: z.enum(['new', 'replied', 'closed']) }).parse(request.body)
    const lead = await db.contactMessage.update({ where: { id }, data: { status } })
    return reply.send(lead)
  })
}
