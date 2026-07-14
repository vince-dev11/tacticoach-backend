// Public blog — marketing content. No auth: these pages exist to be crawled.
// Management lives in the owner-only admin routes (admin.routes.ts).

import type { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { env } from '../../config/env.js'
import { presignUrl } from '../../config/s3.js'

const CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImageKey: true,
  tags: true,
  publishedAt: true,
  readMinutes: true,
} as const

async function withCover<T extends { coverImageKey: string | null }>(post: T) {
  const { coverImageKey, ...rest } = post
  return { ...rest, coverUrl: coverImageKey ? await presignUrl(coverImageKey) : null }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function blogRoutes(app: FastifyInstance) {
  // GET /blog — published posts, newest first
  app.get('/', async (request, reply) => {
    const { page = '1', limit = '12' } = request.query as Record<string, string>
    const take = Math.min(50, Number(limit) || 12)
    const skip = (Math.max(1, Number(page) || 1) - 1) * take
    const [posts, total] = await Promise.all([
      db.blogPost.findMany({
        where: { status: 'published' },
        orderBy: { publishedAt: 'desc' },
        skip,
        take,
        select: CARD_SELECT,
      }),
      db.blogPost.count({ where: { status: 'published' } }),
    ])
    return reply.send({
      posts: await Promise.all(posts.map(withCover)),
      total,
      page: Number(page) || 1,
      limit: take,
    })
  })

  // GET /blog/rss.xml — for subscribers and content distribution
  app.get('/rss.xml', async (_request, reply) => {
    const posts = await db.blogPost.findMany({
      where: { status: 'published' },
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
      where: { status: 'published' },
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
      where: { slug, status: 'published' },
    })
    if (!post) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Post not found' })
    }
    return reply.send(await withCover(post))
  })
}
