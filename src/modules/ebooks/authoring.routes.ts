// Writing a book, as a coach.
//
//   GET    /api/my-books           my books, any status
//   POST   /api/my-books           start one
//   GET    /api/my-books/:id       one of mine, whole
//   PATCH  /api/my-books/:id       cover, blurb, status (submit / withdraw)
//   PUT    /api/my-books/:id/chapters   the whole tree
//   DELETE /api/my-books/:id       bin it
//
// These do what /admin/ebooks does, with the two things that route never
// needed while the company owner was the only author:
//
//   1. EVERY query is scoped by authorId. The admin versions were not — they
//      were `where: { id }` and `findMany({ take: 200 })`, which is a
//      cross-author leak the instant a second author exists. `requireOwner`
//      was hiding that, not fixing it.
//   2. Plan gating. `draft_ebooks` to write at all, the `books` quota on
//      create, `publish_ebooks` to submit for review.
//
// Publishing is not a field a coach can set. They submit; an owner approves.
// See ebook-review.ts for the whole state machine.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authGuard } from '../../middleware/auth-guard.js'
import { requireCapability } from '../../middleware/entitlement-guard.js'
import { assertQuota } from '../../lib/plan-quota.js'
import { can } from '../../lib/capabilities.js'
import { getEntitlements } from '../../lib/entitlements.js'
import { latinOnly } from '../../lib/latin-only.js'
import { sentOnly, touchesMoreThan } from '../../lib/sent-only.js'
import {
  adminList, adminGet, uniqueSlug, replaceChapters, hasContent, removeBook,
  CATEGORIES, AGE_BANDS, BLOCK_KINDS, ebookDelegate, type ChapterInput,
} from './ebooks.service.js'
import { transition, isFrozenToAuthor, type EbookStatus } from './ebook-review.js'
import { authorDashboard, replyToReview, ReviewError } from './engagement.service.js'

const userId = (r: { user: unknown }) => (r.user as { sub: number }).sub

const Cover = z.object({
  template: z.enum(['ball', 'goal', 'boot', 'pitch', 'stand', 'gloves', 'corner', 'kit']),
  bg: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  art: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  font: z.enum(['sans', 'serif', 'cond', 'mono']),
  weight: z.enum(['300', '500', '700', '900']),
  style: z.enum(['normal', 'italic', 'upper']),
  size: z.string().max(6),
})

const BookInput = z.object({
  title: latinOnly(z.string().trim().min(1).max(160)),
  subtitle: latinOnly(z.string().trim().max(200)).optional().nullable(),
  blurb: z.string().max(4000).optional().nullable(),
  category: z.enum(CATEGORIES),
  ageBand: z.enum(AGE_BANDS),
  cover: Cover,
  language: z.string().min(2).max(8).default('en'),
})

/**
 * What an author may ASK for. `published` and `rejected` are deliberately
 * absent: a coach cannot publish their own book, and cannot reject it either.
 * Asking for `published` is asking to skip the queue — the state machine
 * answers that with a sentence rather than silently downgrading it.
 */
const AuthorStatus = z.enum(['draft', 'in_review', 'archived'])

const Chapters = z.object({
  chapters: z.array(z.object({
    title: latinOnly(z.string().trim().min(1).max(200)),
    isSample: z.boolean().default(false),
    blocks: z.array(z.object({
      kind: z.enum(BLOCK_KINDS),
      data: z.record(z.string(), z.unknown()),
    })).max(200),
  })).max(60),
})

const notFound = { statusCode: 404, error: 'Not Found', message: 'Book not found' }

export async function authoringRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authGuard)
  // Writing a book at all is a capability. Free and Basic have it (they are
  // capped at 1 and 3 books); a player account does not.
  app.addHook('preHandler', requireCapability('draft_ebooks'))

  app.get('/', async (request, reply) => reply.send(await adminList(userId(request))))

  // The author's numbers. Registered before '/:id' so "dashboard" is never
  // read as a book id; scoped to the caller inside authorDashboard.
  app.get('/dashboard', async (request, reply) => reply.send(await authorDashboard(userId(request))))

  // One public answer per review, on the author's own books only.
  app.put('/reviews/:reviewId/reply', async (request, reply) => {
    const reviewId = Number((request.params as { reviewId: string }).reviewId)
    const { reply: text } = z.object({ reply: z.string().max(1000).nullable() }).parse(request.body)
    try {
      return reply.send(await replyToReview(userId(request), reviewId, text))
    } catch (err) {
      if (err instanceof ReviewError) {
        return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: 'Not Found', message: err.message })
      }
      throw err
    }
  })

  app.get('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const book = await adminGet(id, userId(request))
    // 404, not 403: someone else's book is not a thing that exists for you,
    // and a 403 would confirm the id is real.
    if (!book) return reply.status(404).send(notFound)
    return reply.send(book)
  })

  app.post('/', async (request, reply) => {
    const input = BookInput.parse(request.body)
    const uid = userId(request)
    // Free gets one book, Basic three. Checked before the row is written, so
    // the refusal costs the coach nothing but the click.
    await assertQuota(uid, 'books')
    const book = await ebookDelegate().create({
      data: {
        ...input,
        subtitle: input.subtitle || null,
        blurb: input.blurb || null,
        slug: await uniqueSlug(input.title),
        authorId: uid,
        // A new book is always a draft. There is no "create it published".
        status: 'draft',
        publishedAt: null,
      },
    })
    return reply.status(201).send(book)
  })

  app.patch('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const uid = userId(request)
    const existing = await adminGet(id, uid)
    if (!existing) return reply.status(404).send(notFound)

    // Validate, then keep only what was sent: `.partial()` leaves the schema's
    // defaults in place, so the parsed object claims `language: 'en'` on a
    // request that never mentioned language. See sent-only.ts.
    const input = sentOnly(
      BookInput.partial().extend({ status: AuthorStatus.optional() }).parse(request.body),
      request.body,
    )
    const from = existing.status as EbookStatus

    // Details of a book under review or in the shop are frozen to its author.
    // Approving what you read means nothing if the author can edit it while
    // you read it. Read from the BODY, not from the parsed object — a default
    // counted as an edit would make "withdraw it to keep editing" impossible
    // to obey, because the withdrawal itself would be refused as an edit.
    const editsDetails = touchesMoreThan(request.body, 'status')
    if (editsDetails && isFrozenToAuthor(from)) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: from === 'in_review'
          ? 'This book is being reviewed. Withdraw it to keep editing.'
          : 'This book is in the shop. Ask us to unpublish it before editing.',
      })
    }

    let statusPatch = {}
    if (input.status && input.status !== from) {
      const ent = await getEntitlements(uid)
      const move = transition({
        from,
        to: input.status,
        isOwner: false,
        firstPublishAt: existing.publishedAt ?? null,
        canPublish: can(ent, 'publish_ebooks'),
        hasContent: await hasContent(id),
      })
      if (!move.ok) {
        // 402 when the plan is what stopped them — the frontend turns that
        // into an upgrade prompt. 422 when it is the book that is not ready.
        const planBlocked = !can(ent, 'publish_ebooks') && input.status === 'in_review'
        return reply.status(planBlocked ? 402 : 422).send({
          statusCode: planBlocked ? 402 : 422,
          error: planBlocked ? 'Payment Required' : 'Unprocessable Entity',
          message: move.reason,
        })
      }
      statusPatch = move.patch ?? {}
    }

    const { status: _dropped, ...details } = input
    void _dropped
    const book = await ebookDelegate().update({
      where: { id },
      data: {
        ...details,
        ...(details.title ? { slug: await uniqueSlug(details.title, id) } : {}),
        ...statusPatch,
      },
    })
    return reply.send(book)
  })

  app.put('/:id/chapters', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const uid = userId(request)

    // Board drawings live inside a block's data, so a chapter carries its own
    // diagrams. That is the right model — a book is self-contained — but it
    // means an unbounded JSON column, and one runaway request fills a disk.
    // A real illustrated chapter is tens of KB.
    const size = Buffer.byteLength(JSON.stringify(request.body ?? {}))
    if (size > 4 * 1024 * 1024) {
      return reply.status(413).send({
        statusCode: 413,
        error: 'Payload Too Large',
        message: 'This chapter is too large to save. Split it, or simplify its drawings.',
      })
    }

    const existing = await adminGet(id, uid)
    if (!existing) return reply.status(404).send(notFound)
    if (isFrozenToAuthor(existing.status as EbookStatus)) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: existing.status === 'in_review'
          ? 'This book is being reviewed. Withdraw it to keep editing.'
          : 'This book is in the shop. Ask us to unpublish it before editing.',
      })
    }

    const { chapters } = Chapters.parse(request.body)
    // latinOnly() widens the title's inferred type; the runtime value is the
    // string Zod validated.
    await replaceChapters(id, chapters as ChapterInput[])
    return reply.send(await adminGet(id, uid))
  })

  app.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const uid = userId(request)
    const existing = await adminGet(id, uid)
    if (!existing) return reply.status(404).send(notFound)
    // A published book has readers — possibly mid-chapter, with notes. Taking
    // it out of the shop is a decision with someone else in it.
    if (existing.status === 'published') {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'This book is in the shop. Ask us to unpublish it first.',
      })
    }
    await removeBook(id)
    return reply.status(204).send()
  })
}
