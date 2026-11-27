// Public blog — marketing content. No auth: these pages exist to be crawled.
// Management lives in the owner-only admin routes (admin.routes.ts).

import type { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { env } from '../../config/env.js'
import { presignUrl } from '../../config/s3.js'
import type { Prisma } from '@prisma/client'
import { BLOG_FORMATS, authorsFor, bylineOf } from './blog.shared.js'

/**
 * BLOG-SCHEDULE (27 Nov 2026, owner: "schedule a blog post and it posts at
 * that date and time"): a scheduled post is `published` with a publish date in
 * the future, and every public read asks for posts whose date has arrived. No
 * background job: nothing to miss if the server restarts, and the post is
 * live at the minute it was set for.
 */
export function livePosts(now: Date = new Date()): Prisma.BlogPostWhereInput {
  return { status: 'published', OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] }
}

/**
 * BLOG-V4 (19 Nov 2026): the blog page's topic chips, Format select and search
 * box, applied here so paging stays right. Unknown values are ignored, so an
 * old link never errors. No filter → exactly the live posts.
 */
export function blogFilters(query: Record<string, unknown>, now: Date = new Date()): Prisma.BlogPostWhereInput {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const tag = str(query.tag, 40)
  const format = str(query.format, 8)
  const q = str(query.q, 80)
  const and: Prisma.BlogPostWhereInput[] = [
    ...(tag ? [{ tags: { array_contains: [tag] } }] : []),
    ...((BLOG_FORMATS as readonly string[]).includes(format) ? [{ formats: { array_contains: [format] } }] : []),
    // MySQL's default collation compares case-insensitively.
    ...(q ? [{ OR: [{ title: { contains: q } }, { excerpt: { contains: q } }] }] : []),
  ]
  const live = livePosts(now)
  return and.length ? { AND: [live, ...and] } : live
}

const CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImageKey: true,
  tags: true,
  publishedAt: true,
  readMinutes: true,
  // BLOG-V4: the labels on a card (age, formats).
  ageGroup: true,
  formats: true,
  // COACH-ARTICLES: the byline (a coach's name and page), null for a team post.
  authorId: true,
  authorKind: true,
} as const

async function withCover<T extends { coverImageKey: string | null }>(post: T) {
  const { coverImageKey, ...rest } = post
  return { ...rest, coverUrl: coverImageKey ? await presignUrl(coverImageKey) : null }
}

/** The public shape: cover URL, byline, and no internal ids. */
async function publicPost<T extends { coverImageKey: string | null; authorId: number; authorKind: 'team' | 'coach' }>(
  post: T,
  authors: Awaited<ReturnType<typeof authorsFor>>,
) {
  const { authorId: _a, authorKind: _k, ...rest } = await withCover(post)
  return { ...rest, author: bylineOf(post, authors) }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function blogRoutes(app: FastifyInstance) {
  // GET /blog — published posts, newest first
  app.get('/', async (request, reply) => {
    const { page = '1', limit = '12' } = request.query as Record<string, string>
    const take = Math.min(50, Number(limit) || 12)
    const skip = (Math.max(1, Number(page) || 1) - 1) * take
    const where = blogFilters(request.query as Record<string, unknown>)
    const [posts, total] = await Promise.all([
      db.blogPost.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip,
        take,
        select: CARD_SELECT,
      }),
      db.blogPost.count({ where }),
    ])
    const authors = await authorsFor(posts)
    return reply.send({
      posts: await Promise.all(posts.map((p) => publicPost(p, authors))),
      total,
      page: Number(page) || 1,
      limit: take,
    })
  })

  // GET /blog/rss.xml — for subscribers and content distribution
  app.get('/rss.xml', async (_request, reply) => {
    const posts = await db.blogPost.findMany({
      where: livePosts(),
      orderBy: { publishedAt: 'desc' },
      take: 20,
      select: { slug: true, title: true, excerpt: true, publishedAt: true },
    })
    const items = posts
      .map(
        (p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${env.FRONTEND_URL}/blog/${p.slug}</link>
      <guid>${env.FRONTEND_URL}/blog/${p.slug}</guid>
      <description>${esc(p.excerpt ?? '')}</description>
      <pubDate>${(p.publishedAt ?? new Date()).toUTCString()}</pubDate>
    </item>`,
      )
      .join('\n')
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>TactiCoach Blog</title>
    <link>${env.FRONTEND_URL}/blog</link>
    <description>Football coaching, tactics and session design — from the TactiCoach team.</description>
${items}
  </channel>
</rss>`
    return reply.type('application/rss+xml').send(xml)
  })

  // GET /blog/sitemap.xml — blog URLs for search engines
  app.get('/sitemap.xml', async (_request, reply) => {
    const posts = await db.blogPost.findMany({
      where: livePosts(),
      orderBy: { publishedAt: 'desc' },
      select: { slug: true, updatedAt: true },
    })
    const urls = posts
      .map(
        (p) => `  <url>
    <loc>${env.FRONTEND_URL}/blog/${p.slug}</loc>
    <lastmod>${p.updatedAt.toISOString().slice(0, 10)}</lastmod>
  </url>`,
      )
      .join('\n')
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${env.FRONTEND_URL}/blog</loc>
  </url>
${urls}
</urlset>`
    return reply.type('application/xml').send(xml)
  })

  // GET /blog/:slug — a single published post (full content)
  app.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const post = await db.blogPost.findFirst({
      where: { slug, ...livePosts() },
    })
    if (!post) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Post not found' })
    }
    // Internal fields stay internal; the review note is the coach's business.
    const { reviewNote: _n, submittedAt: _s, reviewedAt: _r, ...pub } = post
    return reply.send(await publicPost(pub, await authorsFor([post])))
  })
}
