// COACH-ARTICLES (20 Oct 2026): a coach writes an article; it is published on
// the blog only when an admin approves it (admin.routes.ts /blog/:id/review).
//
// Why a review step: the blog is TactiCoach's public voice and it is crawled.
// A coach can write anything they like in a draft, but nothing a visitor or a
// search engine sees goes out unchecked, and only the admin sets the slug and
// the SEO fields. Players and parents never reach these routes: the player
// lockdown is deny-by-default and /api/articles is not on its allow-list.
//
// States: draft → pending (submitted) → published | changes_requested |
// rejected. Editing a published article puts it back to pending and it comes
// off the blog until re-approved (the simple rule; a live copy that stays up
// while the edit is reviewed can come later if coaches ask).

import type { FastifyInstance } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { db } from '../../config/database.js'
import { uploadToS3, deleteFromS3, presignUrl } from '../../config/s3.js'
import { readUpload } from '../../lib/multipart.js'
import { COVER_MAX, COVER_TYPES, readMinutes, slugify, uniqueSlug, withCover } from '../blog/blog.shared.js'

/** What a coach may set. No slug, no SEO fields: those are the admin's. */
const ArticleInput = z.object({
  title: z.string().trim().min(1, 'Give the article a title').max(255),
  excerpt: z.string().trim().max(500).optional().nullable(),
  content: z.string().max(200_000).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
})

/** The states a coach may still edit in. Published goes back to pending on edit. */
const EDITABLE = new Set(['draft', 'changes_requested', 'rejected', 'published', 'pending'])

const LIST_SELECT = {
  id: true, slug: true, title: true, excerpt: true, status: true, tags: true, coverImageKey: true,
  submittedAt: true, reviewedAt: true, reviewNote: true, publishedAt: true, updatedAt: true, readMinutes: true,
} as const

const notFound = (reply: { status: (c: number) => { send: (b: unknown) => unknown } }) =>
  reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Article not found' })

export async function articlesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard)

  const mine = (request: { user: unknown }) => (request.user as { sub: number }).sub

  // GET /articles/mine — the coach's articles, newest first
  app.get('/mine', async (request, reply) => {
    const posts = await db.blogPost.findMany({
      where: { authorId: mine(request), authorKind: 'coach' },
      orderBy: { updatedAt: 'desc' },
      select: LIST_SELECT,
    })
    return reply.send(await Promise.all(posts.map(withCover)))
  })

  // GET /articles/mine/:id — one of mine, in full
  app.get('/mine/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const post = await db.blogPost.findFirst({ where: { id, authorId: mine(request), authorKind: 'coach' } })
    if (!post) return notFound(reply)
    return reply.send(await withCover(post))
  })

  // POST /articles — a new draft
  app.post('/', async (request, reply) => {
    const input = ArticleInput.parse(request.body)
    const post = await db.blogPost.create({
      data: {
        title: input.title,
        slug: await uniqueSlug(slugify(input.title)),
        excerpt: input.excerpt ?? null,
        content: input.content,
        tags: input.tags as Prisma.InputJsonValue,
        status: 'draft',
        readMinutes: readMinutes(input.content),
        authorId: mine(request),
        authorKind: 'coach',
      },
    })
    return reply.status(201).send(await withCover(post))
  })

  // PATCH /articles/:id — edit my article. A published one goes back to pending.
  app.patch('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const existing = await db.blogPost.findFirst({ where: { id, authorId: mine(request), authorKind: 'coach' } })
    if (!existing) return notFound(reply)
    if (!EDITABLE.has(existing.status)) return notFound(reply)
    const input = ArticleInput.partial().parse(request.body)
    const post = await db.blogPost.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.excerpt !== undefined && { excerpt: input.excerpt }),
        ...(input.content !== undefined && { content: input.content, readMinutes: readMinutes(input.content) }),
        ...(input.tags !== undefined && { tags: input.tags as Prisma.InputJsonValue }),
        // Published → pending: it leaves the blog until the admin re-approves it.
        ...(existing.status === 'published' && { status: 'pending', submittedAt: new Date(), reviewNote: null }),
      },
    })
    return reply.send(await withCover(post))
  })

  // POST /articles/:id/submit — send it for review
  app.post('/:id/submit', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const existing = await db.blogPost.findFirst({ where: { id, authorId: mine(request), authorKind: 'coach' } })
    if (!existing) return notFound(reply)
    if (existing.status === 'pending' || existing.status === 'published') {
      return reply.send({ id: existing.id, status: existing.status })
    }
    if (!existing.title.trim() || existing.content.trim().length < 200) {
      return reply.status(422).send({
        statusCode: 422, error: 'Unprocessable Entity',
        message: 'Write a title and at least a few paragraphs before submitting',
        issues: [{ path: ['content'], message: 'At least 200 characters' }],
      })
    }
    const post = await db.blogPost.update({
      where: { id },
      data: { status: 'pending', submittedAt: new Date(), reviewNote: null },
    })
    return reply.send({ id: post.id, status: post.status })
  })

  // POST /articles/:id/withdraw — take it back out of the review queue
  app.post('/:id/withdraw', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const existing = await db.blogPost.findFirst({ where: { id, authorId: mine(request), authorKind: 'coach' } })
    if (!existing) return notFound(reply)
    if (existing.status !== 'pending') return reply.send({ id: existing.id, status: existing.status })
    const post = await db.blogPost.update({ where: { id }, data: { status: 'draft', submittedAt: null } })
    return reply.send({ id: post.id, status: post.status })
  })

  // POST /articles/:id/cover — cover image
  app.post('/:id/cover', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const post = await db.blogPost.findFirst({ where: { id, authorId: mine(request), authorKind: 'coach' }, select: { id: true, coverImageKey: true } })
    if (!post) return notFound(reply)
    const file = await readUpload(request, { maxBytes: COVER_MAX, allowedTypes: COVER_TYPES })
    if (post.coverImageKey) await deleteFromS3(post.coverImageKey).catch(() => {})
    const ext = file.mimetype === 'image/webp' ? 'webp' : file.mimetype === 'image/png' ? 'png' : 'jpg'
    const key = `blog/${id}/cover-${Date.now()}.${ext}`
    await uploadToS3(key, file.buffer, file.mimetype)
    await db.blogPost.update({ where: { id }, data: { coverImageKey: key } })
    return reply.send({ coverUrl: await presignUrl(key) })
  })

  // DELETE /articles/:id — mine, and not live (a live one is the admin's to take down)
  app.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const post = await db.blogPost.findFirst({ where: { id, authorId: mine(request), authorKind: 'coach' }, select: { coverImageKey: true, status: true } })
    if (!post) return notFound(reply)
    if (post.status === 'published') {
      return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'This article is live. Ask us to take it down.' })
    }
    if (post.coverImageKey) await deleteFromS3(post.coverImageKey).catch(() => {})
    await db.blogPost.delete({ where: { id } })
    return reply.status(204).send()
  })
}
