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
import { withQuota } from '../../lib/plan-quota.js'
import { can } from '../../lib/capabilities.js'
import { getEntitlements } from '../../lib/entitlements.js'
import { latinOnly } from '../../lib/latin-only.js'
import { sentOnly, touchesMoreThan } from '../../lib/sent-only.js'
import {
  adminList, adminGet, uniqueSlug, replaceChapters, hasContent, removeBook,
  CATEGORIES, AGE_BANDS, BLOCK_KINDS, FORMATS, COUNTRIES, TOPICS, encodeTopics, ebookDelegate, type ChapterInput,
} from './ebooks.service.js'
import { transition, isFrozenToAuthor, type EbookStatus } from './ebook-review.js'
import { authorDashboard, replyToReview, ReviewError } from './engagement.service.js'
import { AUDIENCES, writableClub } from './club-books.js'
import { inviteToken } from './course.service.js'
import { db } from '../../config/database.js'
import { refineVideoBlock } from '../../lib/video-link.js'
import { listPack, setPack, PackError, PACK_MAX } from './session-pack.service.js'
import { readUpload } from '../../lib/multipart.js'
import { uploadToS3, deleteFromS3 } from '../../config/s3.js'
import { env } from '../../config/env.js'
import { sendCoauthorInviteEmail } from '../../lib/emails.js'

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
  // Who it is for beyond age (migration 46). null = not set / any country.
  format: z.enum(FORMATS).nullable().optional(),
  country: z.enum(COUNTRIES).nullable().optional(),
  topics: z.array(z.enum(TOPICS)).max(3, { message: 'Pick up to three topics' }).transform(encodeTopics).optional(),
  cover: Cover,
  language: z.string().min(2).max(8).default('en'),
  // Course mode (course.service). The pass mark is ours, not the author's:
  // 80%, so a TactiCoach certificate means the same thing on every course.
  isCourse: z.boolean().optional(),
  studyMinutes: z.number().int().min(0).max(6000).nullable().optional(),
  // Series: the id of one of the author's series, and the book's place in it.
  seriesId: z.number().int().positive().nullable().optional(),
  seriesOrder: z.number().int().min(1).max(99).nullable().optional(),
  clubAudience: z.enum(AUDIENCES).optional(),
  // The author's price, in pence: 0 = free, otherwise 99p to £200. Whole
  // pence only. Club books are never sold, so it is ignored for them.
  pricePence: z.number().int().min(0).max(20_000).refine((p) => p === 0 || p >= 99, { message: 'A paid book costs at least 99p' }).optional(),
})

/**
 * What an author may ASK for. `published` and `rejected` are deliberately
 * absent: a coach cannot publish their own book, and cannot reject it either.
 * Asking for `published` is asking to skip the queue — the state machine
 * answers that with a sentence rather than silently downgrading it.
 */
const AuthorStatus = z.enum(['draft', 'in_review', 'archived', 'published'])

const Chapters = z.object({
  chapters: z.array(z.object({
    key: z.string().max(24).optional(),
    title: latinOnly(z.string().trim().min(1).max(200)),
    isSample: z.boolean().default(false),
    blocks: z.array(z.object({
      kind: z.enum(BLOCK_KINDS),
      data: z.record(z.string(), z.unknown()),
    }).superRefine(refineVideoBlock)).max(200),
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
    const { clubBook } = z.object({ clubBook: z.boolean().optional() }).parse(request.body)
    const uid = userId(request)
    // A club book: only the club's owner or an admin writes one.
    const clubId = clubBook ? await writableClub(uid) : null
    if (clubBook && !clubId) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only a club owner or club admin can write club books.' })
    }
    // Free gets one book, Basic three. Checked before the row is written, so
    // the refusal costs the coach nothing but the click.
    const { seriesId, seriesOrder, clubAudience, ...rest } = input
    void seriesId
    void seriesOrder
    const book = await withQuota(uid, 'books', async () => ebookDelegate().create({
      data: {
        ...rest,
        ...(clubId ? { clubId, clubAudience: clubAudience ?? 'coaches', pricePence: 0 } : {}),
        subtitle: input.subtitle || null,
        blurb: input.blurb || null,
        slug: await uniqueSlug(input.title),
        authorId: uid,
        // A new book is always a draft. There is no "create it published".
        status: 'draft',
        publishedAt: null,
      },
    }))
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
    const isAuthor = existing.authorId === uid
    // A club book is the club's own document: its owner (or an admin) is its
    // reviewer, and it is never frozen — nobody outside the club reads it.
    const clubBook = !!existing.clubId
    const clubWriter = clubBook && (await writableClub(uid)) === existing.clubId

    // The series is the author's to arrange (a co-author writes, the author
    // decides where the book sits), and it must be one of theirs.
    if (input.seriesId !== undefined || input.seriesOrder !== undefined) {
      if (!isAuthor) {
        return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only the book\'s author can change its series.' })
      }
      if (input.seriesId) {
        const own = await db.ebookSeries.findFirst({ where: { id: input.seriesId, ownerId: existing.authorId }, select: { id: true } })
        if (!own) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Series not found' })
      }
    }
    if (input.clubAudience !== undefined && !clubBook) delete input.clubAudience
    // Club books are never sold.
    if (input.pricePence !== undefined && clubBook) delete input.pricePence

    // Details of a book under review or in the shop are frozen to its author.
    // Approving what you read means nothing if the author can edit it while
    // you read it. Read from the BODY, not from the parsed object — a default
    // counted as an edit would make "withdraw it to keep editing" impossible
    // to obey, because the withdrawal itself would be refused as an edit.
    const editsDetails = touchesMoreThan(request.body, 'status')
    if (editsDetails && isFrozenToAuthor(from) && !clubBook) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: from === 'in_review'
          ? 'This book is being reviewed. Withdraw it to keep editing.'
          : 'This book is in the shop. Ask us to unpublish it before editing.',
      })
    }

    let statusPatch = {}
    if (input.status && input.status !== from && clubBook) {
      if (!clubWriter) {
        return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only the club owner or a club admin can publish club books.' })
      }
      if (input.status === 'published' && !(await hasContent(id))) {
        return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'Add at least one chapter with something in it before publishing.' })
      }
      const move = transition({
        from, to: input.status, isOwner: true, firstPublishAt: existing.publishedAt ?? null,
        canPublish: true, hasContent: true,
      })
      if (!move.ok) return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: move.reason })
      statusPatch = move.patch ?? {}
    } else if (input.status && input.status !== from) {
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
    if (isFrozenToAuthor(existing.status as EbookStatus) && !existing.clubId) {
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

  // ---- Share image (2 Oct 2026) -------------------------------------------
  // POST /api/my-books/:id/share-image — the cover as a 1200×630 card, made in
  // the author's browser on save. Author or co-author; PNG/JPEG up to 1.5 MB.
  app.post('/:id/share-image', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const existing = await adminGet(id, userId(request))
    if (!existing) return reply.status(404).send(notFound)
    const file = await readUpload(request, { maxBytes: 1.5 * 1024 * 1024, allowedTypes: ['image/png', 'image/jpeg'] })
    const old = (existing as { shareImageKey?: string | null }).shareImageKey
    const key = `ebooks/${id}/share-${Date.now()}.${file.mimetype === 'image/png' ? 'png' : 'jpg'}`
    await uploadToS3(key, file.buffer, file.mimetype)
    await ebookDelegate().update({ where: { id }, data: { shareImageKey: key } })
    if (old) await deleteFromS3(old).catch(() => {})
    return reply.send({ ok: true })
  })

  // ---- Session pack (2 Oct 2026) ------------------------------------------
  // GET /api/my-books/:id/pack — the frozen sessions this book carries.
  app.get('/:id/pack', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const existing = await adminGet(id, userId(request))
    if (!existing) return reply.status(404).send(notFound)
    return reply.send(await listPack(id))
  })

  // PUT /api/my-books/:id/pack { sessionIds } — re-freeze the pack from the
  // author's own sessions. Author only (a co-author's sessions are not the
  // book's author's to sell), under the same freeze as the chapters.
  app.put('/:id/pack', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const uid = userId(request)
    const existing = await adminGet(id, uid)
    if (!existing) return reply.status(404).send(notFound)
    if (existing.authorId !== uid) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only the book\'s author can choose its sessions.' })
    }
    if (isFrozenToAuthor(existing.status as EbookStatus) && !existing.clubId) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: existing.status === 'in_review'
          ? 'This book is being reviewed. Withdraw it to change its sessions.'
          : 'This book is in the shop. Ask us to unpublish it before changing its sessions.',
      })
    }
    const { sessionIds } = z.object({ sessionIds: z.array(z.number().int().positive()).max(PACK_MAX, { message: `A pack holds up to ${PACK_MAX} sessions.` }) }).parse(request.body)
    try {
      return reply.send(await setPack(id, uid, sessionIds))
    } catch (err) {
      if (err instanceof PackError) return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: 'Error', message: err.message })
      throw err
    }
  })

  app.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const uid = userId(request)
    const existing = await adminGet(id, uid)
    if (!existing) return reply.status(404).send(notFound)
    // A co-author writes the book; only its author may bin it.
    if (existing.authorId !== uid) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only the book\'s author can delete it.' })
    }
    // A published book has readers — possibly mid-chapter, with notes. Taking
    // it out of the shop is a decision with someone else in it.
    if (existing.status === 'published' && !existing.clubId) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'This book is in the shop. Ask us to unpublish it first.',
      })
    }
    await removeBook(id)
    return reply.status(204).send()
  })

  // ---- Series ----------------------------------------------------------------------
  //
  //   GET    /series          my series, with their books in order
  //   POST   /series          { title }
  //   PATCH  /series/:sid     { title }
  //   DELETE /series/:sid     the books stay; they just leave the series

  const SeriesInput = z.object({ title: latinOnly(z.string().trim().min(1).max(120)) })

  app.get('/series', async (request, reply) => {
    const rows = await db.ebookSeries.findMany({
      where: { ownerId: userId(request) },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, title: true,
        books: { orderBy: [{ seriesOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, title: true, status: true, seriesOrder: true, cover: true } },
      },
    })
    return reply.send(rows)
  })

  app.post('/series', async (request, reply) => {
    const { title } = SeriesInput.parse(request.body)
    const made = await db.ebookSeries.create({ data: { ownerId: userId(request), title: title as string } })
    return reply.status(201).send({ id: made.id, title: made.title, books: [] })
  })

  app.patch('/series/:sid', async (request, reply) => {
    const sid = Number((request.params as { sid: string }).sid)
    const { title } = SeriesInput.parse(request.body)
    const own = await db.ebookSeries.findFirst({ where: { id: sid, ownerId: userId(request) }, select: { id: true } })
    if (!own) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Series not found' })
    await db.ebookSeries.update({ where: { id: sid }, data: { title: title as string } })
    return reply.send({ ok: true })
  })

  app.delete('/series/:sid', async (request, reply) => {
    const sid = Number((request.params as { sid: string }).sid)
    const own = await db.ebookSeries.findFirst({ where: { id: sid, ownerId: userId(request) }, select: { id: true } })
    if (!own) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Series not found' })
    // ON DELETE SET NULL on ebooks.series_id: the books stay, out of the series.
    await db.ebookSeries.delete({ where: { id: sid } })
    return reply.status(204).send()
  })

  // ---- Co-authors ------------------------------------------------------------------
  //
  //   POST   /:id/coauthors             { email, sharePercent }   the author invites
  //   PATCH  /:id/coauthors/:cid        { sharePercent }
  //   DELETE /:id/coauthors/:cid        remove (or withdraw the invite)
  //   GET    /coauthors/invite/:token   what am I being invited to?
  //   POST   /coauthors/accept          { token }   the invitee accepts
  //
  // Only the author manages co-authors. The shares must add up to 100 or less
  // with the author keeping the rest — agreed now, used when sales exist.

  const MAX_COAUTHORS = 3

  const authorBook = async (id: number, uid: number) =>
    db.ebook.findFirst({ where: { id, authorId: uid }, select: { id: true, title: true, coauthors: { select: { id: true, sharePercent: true } } } })

  app.post('/:id/coauthors', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id)
    const uid = userId(request)
    const { email, sharePercent } = z.object({
      email: z.string().trim().toLowerCase().email().max(255),
      sharePercent: z.number().int().min(0).max(90).default(0),
    }).parse(request.body)
    const book = await authorBook(id, uid)
    if (!book) return reply.status(404).send(notFound)
    const me = await db.user.findUnique({ where: { id: uid }, select: { email: true, name: true, surname: true } })
    if (me?.email.toLowerCase() === email) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'You are already the author.' })
    }
    if (book.coauthors.length >= MAX_COAUTHORS) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: `A book can have up to ${MAX_COAUTHORS} co-authors.` })
    }
    const shared = book.coauthors.reduce((n, c) => n + c.sharePercent, 0) + sharePercent
    if (shared > 90) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'Co-authors can share at most 90% — the author keeps at least 10%.' })
    }
    const existing = await db.ebookCoauthor.findUnique({ where: { ebookId_email: { ebookId: id, email } }, select: { id: true } })
    if (existing) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'That person is already invited.' })
    const token = inviteToken()
    const row = await db.ebookCoauthor.create({ data: { ebookId: id, email, sharePercent, token } })
    void sendCoauthorInviteEmail({
      to: email,
      inviterName: me ? [me.name, me.surname].filter(Boolean).join(' ') : 'A coach',
      bookTitle: book.title,
      acceptUrl: `${env.FRONTEND_URL}/books/co-author/${token}`,
    })
    return reply.status(201).send({ id: row.id, email: row.email, sharePercent: row.sharePercent, acceptedAt: null, user: null })
  })

  app.patch('/:id/coauthors/:cid', async (request, reply) => {
    const { id, cid } = request.params as { id: string; cid: string }
    const { sharePercent } = z.object({ sharePercent: z.number().int().min(0).max(90) }).parse(request.body)
    const book = await authorBook(Number(id), userId(request))
    if (!book || !book.coauthors.some((c) => c.id === Number(cid))) return reply.status(404).send(notFound)
    const others = book.coauthors.filter((c) => c.id !== Number(cid)).reduce((n, c) => n + c.sharePercent, 0)
    if (others + sharePercent > 90) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'Co-authors can share at most 90% — the author keeps at least 10%.' })
    }
    await db.ebookCoauthor.update({ where: { id: Number(cid) }, data: { sharePercent } })
    return reply.send({ ok: true })
  })

  app.delete('/:id/coauthors/:cid', async (request, reply) => {
    const { id, cid } = request.params as { id: string; cid: string }
    const book = await authorBook(Number(id), userId(request))
    if (!book || !book.coauthors.some((c) => c.id === Number(cid))) return reply.status(404).send(notFound)
    await db.ebookCoauthor.delete({ where: { id: Number(cid) } })
    return reply.status(204).send()
  })

  app.get('/coauthors/invite/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const invite = await db.ebookCoauthor.findUnique({
      where: { token },
      select: { email: true, acceptedAt: true, ebook: { select: { title: true, author: { select: { name: true, surname: true } } } } },
    })
    if (!invite) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'This invite is no longer valid.' })
    const me = await db.user.findUnique({ where: { id: userId(request) }, select: { email: true } })
    return reply.send({
      bookTitle: invite.ebook.title,
      author: [invite.ebook.author.name, invite.ebook.author.surname].filter(Boolean).join(' '),
      accepted: !!invite.acceptedAt,
      // Said up front rather than after they press Accept.
      emailMatches: me?.email.toLowerCase() === invite.email.toLowerCase(),
      invitedEmail: invite.email,
    })
  })

  app.post('/coauthors/accept', async (request, reply) => {
    const { token } = z.object({ token: z.string().min(10).max(64) }).parse(request.body)
    const uid = userId(request)
    const invite = await db.ebookCoauthor.findUnique({ where: { token }, select: { id: true, email: true, ebookId: true, acceptedAt: true } })
    if (!invite) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'This invite is no longer valid.' })
    const me = await db.user.findUnique({ where: { id: uid }, select: { email: true } })
    // The invite is for an address, and so is the account: a forwarded link
    // must not let somebody else become a co-author.
    if (me?.email.toLowerCase() !== invite.email.toLowerCase()) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: `This invite was sent to ${invite.email}. Sign in with that account to accept it.` })
    }
    if (!invite.acceptedAt) {
      await db.ebookCoauthor.update({ where: { id: invite.id }, data: { userId: uid, acceptedAt: new Date() } })
    }
    return reply.send({ ok: true, ebookId: invite.ebookId })
  })
}
