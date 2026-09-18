// Ebook routes.
//
//   GET  /api/ebooks                 the shop — covers and metadata
//   GET  /api/ebooks/:slug           one book: blurb + chapter TITLES
//   GET  /api/ebooks/:slug/contents  the contents list
//   GET  /api/ebooks/:slug/c/:id     ONE chapter's blocks — the only readable route
//   POST /api/ebooks/:slug/progress  how far they have got
//
// All signed in. A book is not public: the shop is something you browse from
// inside the app, and serving chapters to anonymous callers would undo the
// "cannot be downloaded" position before it ever had a chance.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import {
  listBooks, getBook, getChapter, getContents, saveProgress, getProgress,
} from './ebooks.service.js'

const userId = (r: { user: unknown }) => (r.user as { sub: number }).sub

export async function ebooksRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authGuard)

  app.get('/', async (request, reply) => {
    const q = request.query as Record<string, string>
    return reply.send(
      await listBooks({ category: q.category, ageBand: q.age, sort: q.sort as 'new', q: q.q }),
    )
  })

  app.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const book = await getBook(slug)
    if (!book) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Book not found' })
    }
    const progress = await getProgress(userId(request), book.id)
    return reply.send({ ...book, progress: progress ?? null })
  })

  app.get('/:slug/contents', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    return reply.send(await getContents(slug))
  })

  // The only route that returns readable text. One chapter, by id, always.
  app.get('/:slug/c/:chapterId', async (request, reply) => {
    const { slug, chapterId } = request.params as { slug: string; chapterId: string }
    const chapter = await getChapter(slug, Number(chapterId))
    if (!chapter) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Chapter not found' })
    }
    if (chapter.locked) {
      // 402 rather than 403: this is not "you may never", it is "not yet, and
      // there is a thing you could do about it". Purchasing does not exist
      // yet, so for now it simply means the sample has run out.
      return reply.status(402).send({
        statusCode: 402,
        error: 'Payment Required',
        message: 'This chapter is part of the full book.',
        title: chapter.title,
      })
    }
    return reply.send(chapter)
  })

  app.post('/:slug/progress', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const body = z
      .object({ chapterId: z.number().int().positive(), percent: z.number().min(0).max(100) })
      .parse(request.body)
    const book = await getBook(slug)
    if (!book) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Book not found' })
    }
    await saveProgress(userId(request), book.id, body.chapterId, body.percent)
    return reply.send({ ok: true })
  })
}
