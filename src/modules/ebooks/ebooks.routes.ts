// Ebook routes.
//
//   GET    /api/ebooks                    the shop — covers, metadata, ratings    PUBLIC
//   GET    /api/ebooks/sitemap.xml        published books for search engines      PUBLIC
//   GET    /api/ebooks/:slug              one book: blurb + chapter TITLES        PUBLIC
//   GET    /api/ebooks/:slug/contents     the contents list                       PUBLIC
//   GET    /api/ebooks/:slug/c/:id        ONE chapter's blocks                    sample: PUBLIC, rest: signed in
//   POST   /api/ebooks/:slug/progress     how far they have got                   signed in
//   GET    /api/ebooks/:slug/reviews      reviews + whether the viewer may write  PUBLIC
//   PUT    /api/ebooks/:slug/reviews/mine create/edit the viewer's review         signed in, read ≥ 50%
//   DELETE /api/ebooks/:slug/reviews/mine                                          signed in
//
// Why the shop is public now: a book nobody outside the app can find is a
// book nobody buys. What stays closed is the text. A signed-out visitor can
// read the SAMPLE chapter and nothing else; every other chapter still needs
// an account (and, on a paid book, a purchase). Still one chapter per request,
// so "cannot be downloaded" holds exactly as before.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { env } from '../../config/env.js'
import {
  listBooks, getBook, getChapter, getContents, saveProgress, getProgress, sitemapBooks,
} from './ebooks.service.js'
import { bump, isBot, listReviews, saveReview, deleteReview, ReviewError } from './engagement.service.js'
import {
  loadCourse, courseStatus, markRead, answer, chapterAnswers, issueCertificate, badgesFor,
  myCertificates, CourseError,
} from './course.service.js'
import { mayOpen, clubLibrary, clubReaders } from './club-books.js'
import { startCheckout, joinWaitlist, library, PurchaseError } from './purchases.service.js'

const userId = (r: { user: unknown }) => (r.user as { sub: number }).sub

const NON_ACCESS_TOKEN_TYPES = new Set(['refresh', 'verify-email'])

/**
 * The viewer's id when a valid ACCESS token is present; undefined otherwise.
 * Never rejects — these routes are open to everyone. Refresh and email
 * tokens are refused exactly as authGuard refuses them.
 */
async function optionalUserId(request: FastifyRequest): Promise<number | undefined> {
  if (!request.headers.authorization) return undefined
  try {
    await request.jwtVerify()
    const u = request.user as { sub?: number; type?: string }
    if (u?.type && NON_ACCESS_TOKEN_TYPES.has(u.type)) return undefined
    return u?.sub
  } catch {
    return undefined
  }
}

const notFound = { statusCode: 404, error: 'Not Found', message: 'Book not found' }

const ReviewInput = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().max(1000).optional().nullable(),
})

function sendReviewError(reply: import('fastify').FastifyReply, err: unknown) {
  if (err instanceof ReviewError) {
    return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.statusCode === 404 ? 'Not Found' : 'Forbidden', message: err.message })
  }
  throw err
}

/** A published course this signed-in reader may open, or the reason why not. */
async function courseFor(slug: string, viewer: number) {
  const book = await loadCourse(slug)
  if (!(await mayOpen(book, viewer))) throw new CourseError(404, 'Book not found')
  return book
}

function sendCourseError(reply: import('fastify').FastifyReply, err: unknown) {
  if (err instanceof CourseError) {
    return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: 'Error', message: err.message })
  }
  throw err
}

export async function ebooksRoutes(app: FastifyInstance) {
  app.get('/', async (request, reply) => {
    const q = request.query as Record<string, string>
    return reply.send(
      await listBooks({ category: q.category, ageBand: q.age, sort: q.sort as 'new', q: q.q }),
    )
  })

  // ---- Mine, and my club's (registered before /:slug) ----------------------------

  app.get('/me/badges', { preHandler: authGuard }, async (request, reply) =>
    reply.send(await badgesFor(userId(request))))

  app.get('/me/certificates', { preHandler: authGuard }, async (request, reply) =>
    reply.send(await myCertificates(userId(request))))

  // GET /api/ebooks/me/library — the books this reader owns.
  app.get('/me/library', { preHandler: authGuard }, async (request, reply) =>
    reply.send(await library(userId(request))))

  // POST /api/ebooks/:slug/checkout { consent: true } — buy the book.
  // → { status: 'paid' } (owner test purchase) | { status: 'redirect', url }
  // Refusals carry a code: coming_soon, owned, free, own_book, consent.
  app.post('/:slug/checkout', {
    preHandler: authGuard,
    config: { rateLimit: { max: process.env.NODE_ENV === 'test' ? 10_000 : 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const { consent } = z.object({ consent: z.boolean().default(false) }).parse(request.body ?? {})
    try {
      return reply.send(await startCheckout(userId(request), slug, consent))
    } catch (err) {
      if (err instanceof PurchaseError) return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.code, message: err.message })
      throw err
    }
  })

  // POST /api/ebooks/:slug/waitlist — "email me when I can buy this".
  app.post('/:slug/waitlist', { preHandler: authGuard }, async (request, reply) => {
    const { slug } = request.params as { slug: string }
    try {
      return reply.send(await joinWaitlist(userId(request), slug))
    } catch (err) {
      if (err instanceof PurchaseError) return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.code, message: err.message })
      throw err
    }
  })

  app.get('/club/library', { preHandler: authGuard }, async (request, reply) =>
    reply.send(await clubLibrary(userId(request))))

  app.get('/club/:id/readers', { preHandler: authGuard }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const out = await clubReaders(userId(request), id)
    if (!out) return reply.status(404).send(notFound)
    return reply.send(out)
  })

  // Registered before /:slug; find-my-way prefers the static route anyway.
  app.get('/sitemap.xml', async (_request, reply) => {
    const books = await sitemapBooks().catch(() => [])
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const urls = books
      .map((b) => `  <url>
    <loc>${env.FRONTEND_URL}/books/${esc(b.slug)}</loc>
    <lastmod>${new Date(b.updatedAt).toISOString().slice(0, 10)}</lastmod>
  </url>`)
      .join('\n')
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${env.FRONTEND_URL}/books</loc>
  </url>
${urls}
</urlset>`
    return reply.type('application/xml').send(xml)
  })

  app.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const viewer = await optionalUserId(request)
    const book = await getBook(slug, viewer)
    if (!book) return reply.status(404).send(notFound)
    const { _authorId, ...publicBook } = book
    // The author checking their own page is not a visitor.
    if (viewer !== _authorId && !isBot(request.headers['user-agent'])) void bump(book.id, 'pageViews')
    const progress = viewer ? await getProgress(viewer, book.id) : null
    return reply.send({ ...publicBook, progress: progress ?? null })
  })

  app.get('/:slug/contents', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    return reply.send(await getContents(slug, await optionalUserId(request)))
  })

  // The only route that returns readable text. One chapter, by id, always.
  app.get('/:slug/c/:chapterId', async (request, reply) => {
    const { slug, chapterId } = request.params as { slug: string; chapterId: string }
    const viewer = await optionalUserId(request)
    const chapter = await getChapter(slug, Number(chapterId), { signedIn: !!viewer, viewer })
    if (!chapter) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Chapter not found' })
    }
    if (chapter.locked) {
      // 401 for a stranger past the sample ("make an account"); 402 for a
      // signed-in reader of a paid book ("not yet, and there is a thing you
      // could do about it"). Different doors, so different answers.
      if (chapter.reason === 'signin') {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Sign up free to keep reading.',
          signupToRead: true,
          title: chapter.title,
        })
      }
      return reply.status(402).send({
        statusCode: 402,
        error: 'Payment Required',
        message: 'This chapter is part of the full book.',
        title: chapter.title,
      })
    }
    if (!isBot(request.headers['user-agent'])) {
      void bump(chapter.ebookId, chapter.sample ? 'sampleReads' : 'chapterReads')
    }
    const { sample: _sample, ...body } = chapter
    void _sample
    return reply.send(body)
  })

  app.post('/:slug/progress', { preHandler: authGuard }, async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const body = z
      .object({ chapterId: z.number().int().positive(), percent: z.number().min(0).max(100) })
      .parse(request.body)
    const book = await getBook(slug, userId(request))
    if (!book) return reply.status(404).send(notFound)
    await saveProgress(userId(request), book.id, body.chapterId, body.percent)
    return reply.send({ ok: true })
  })

  // ---- Courses -------------------------------------------------------------------
  //
  //   GET  /:slug/course                  my progress, score, certificate
  //   POST /:slug/c/:chapterId/done       I read this chapter to the end
  //   GET  /:slug/c/:chapterId/answers    my earlier answers in this chapter
  //   POST /:slug/quiz/:questionId        mark my answer
  //   POST /:slug/certificate             issue it (when passed)

  app.get('/:slug/course', { preHandler: authGuard }, async (request, reply) => {
    const { slug } = request.params as { slug: string }
    try {
      return reply.send(await courseStatus(userId(request), await courseFor(slug, userId(request))))
    } catch (err) {
      return sendCourseError(reply, err)
    }
  })

  app.post('/:slug/c/:chapterId/done', { preHandler: authGuard }, async (request, reply) => {
    const { slug, chapterId } = request.params as { slug: string; chapterId: string }
    try {
      const book = await courseFor(slug, userId(request))
      await markRead(userId(request), book, Number(chapterId))
      return reply.send(await courseStatus(userId(request), book))
    } catch (err) {
      return sendCourseError(reply, err)
    }
  })

  app.get('/:slug/c/:chapterId/answers', { preHandler: authGuard }, async (request, reply) => {
    const { slug, chapterId } = request.params as { slug: string; chapterId: string }
    try {
      return reply.send(await chapterAnswers(userId(request), await courseFor(slug, userId(request)), Number(chapterId)))
    } catch (err) {
      return sendCourseError(reply, err)
    }
  })

  app.post(
    '/:slug/quiz/:questionId',
    // Generous for a real reader (a chapter quiz is a handful of clicks) and
    // tight enough that nobody scripts through the answers.
    { preHandler: authGuard, config: { rateLimit: { max: 120, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const { slug, questionId } = request.params as { slug: string; questionId: string }
      const { choice } = z.object({ choice: z.number().int().min(0).max(20) }).parse(request.body)
      try {
        return reply.send(await answer(userId(request), await courseFor(slug, userId(request)), questionId, choice))
      } catch (err) {
        return sendCourseError(reply, err)
      }
    },
  )

  app.post('/:slug/certificate', { preHandler: authGuard, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request, reply) => {
    const { slug } = request.params as { slug: string }
    try {
      return reply.send(await issueCertificate(userId(request), await courseFor(slug, userId(request))))
    } catch (err) {
      return sendCourseError(reply, err)
    }
  })

  // ---- Reviews -------------------------------------------------------------------

  app.get('/:slug/reviews', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    try {
      return reply.send(await listReviews(slug, await optionalUserId(request)))
    } catch (err) {
      return sendReviewError(reply, err)
    }
  })

  app.put(
    '/:slug/reviews/mine',
    { preHandler: authGuard, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const { slug } = request.params as { slug: string }
      const input = ReviewInput.parse(request.body)
      try {
        return reply.send(await saveReview(slug, userId(request), input))
      } catch (err) {
        return sendReviewError(reply, err)
      }
    },
  )

  app.delete('/:slug/reviews/mine', { preHandler: authGuard }, async (request, reply) => {
    const { slug } = request.params as { slug: string }
    try {
      return reply.send(await deleteReview(slug, userId(request)))
    } catch (err) {
      return sendReviewError(reply, err)
    }
  })
}
