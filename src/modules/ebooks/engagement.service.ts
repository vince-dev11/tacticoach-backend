// Everything around a book that is not the book: counting who looks, the
// reviews readers leave, and the numbers an author sees on their dashboard.
//
// Counters are per-book, per-DAY aggregates — no row records who looked, so
// there is nothing personal here to leak, export or delete. Reviews do carry
// a user id (one review per reader), and show only a first name + initial.

import { db } from '../../config/database.js'

/** A reader must have got this far through a book before rating it. */
export const REVIEW_MIN_PERCENT = 50
/** Counts as "finished" on the dashboard. */
export const FINISHED_PERCENT = 90

function delegate<T>(name: string): T {
  const found = (db as unknown as Record<string, unknown>)[name]
  if (!found) {
    const error = new Error(
      'Book reviews are not available on this deployment yet. Run "npx prisma migrate deploy" ' +
      'and "npx prisma generate" in the API, then restart it.',
    ) as Error & { statusCode: number }
    error.statusCode = 503
    throw error
  }
  return found as T
}

interface ReviewRow {
  id: number
  ebookId: number
  userId: number
  rating: number
  body: string | null
  hidden: boolean
  authorReply: string | null
  createdAt: Date
  updatedAt: Date
  user?: { name: string; surname: string | null }
  ebook?: { title: string; slug: string }
}

const reviewDb = () =>
  delegate<{
    findMany(a?: unknown): Promise<ReviewRow[]>
    findFirst(a?: unknown): Promise<ReviewRow | null>
    findUnique(a?: unknown): Promise<ReviewRow | null>
    upsert(a: unknown): Promise<ReviewRow>
    update(a: unknown): Promise<ReviewRow>
    delete(a: unknown): Promise<ReviewRow>
    groupBy(a: unknown): Promise<{ ebookId: number; rating?: number; _avg?: { rating: number | null }; _count?: { _all: number } }[]>
  }>('ebookReview')

const statDb = () =>
  delegate<{
    upsert(a: unknown): Promise<unknown>
    findMany(a?: unknown): Promise<{ ebookId: number; day: Date; pageViews: number; sampleReads: number; chapterReads: number }[]>
  }>('ebookDailyStat')

const bookDb = () =>
  delegate<{
    findFirst(a?: unknown): Promise<{ id: number; authorId: number; title: string; slug: string; status: string } | null>
    findMany(a?: unknown): Promise<{ id: number; title: string; slug: string; status: string; pricePence: number; publishedAt: Date | null }[]>
  }>('ebook')

const progressDb = () =>
  delegate<{
    findUnique(a: unknown): Promise<{ percent: number } | null>
    findMany(a?: unknown): Promise<{ ebookId: number; percent: number }[]>
  }>('ebookProgress')

// ---- Counters ------------------------------------------------------------------

export type StatField = 'pageViews' | 'sampleReads' | 'chapterReads'

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|headless|lighthouse/i

/** Crawlers and link-preview fetchers are not readers. */
export function isBot(userAgent: string | undefined): boolean {
  return !userAgent || BOT_UA.test(userAgent)
}

/** UTC calendar day, as the DATE column stores it. */
export function dayOf(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * +1 on today's row. Fire-and-forget: a counter that fails must never fail
 * the page a reader asked for, so this swallows its own errors.
 */
export async function bump(ebookId: number, field: StatField): Promise<void> {
  try {
    const day = dayOf()
    await statDb().upsert({
      where: { ebookId_day: { ebookId, day } },
      update: { [field]: { increment: 1 } },
      create: { ebookId, day, [field]: 1 },
    })
  } catch {
    /* counters are best-effort */
  }
}

// ---- Ratings -------------------------------------------------------------------

export interface RatingSummary {
  average: number | null
  count: number
}

const round1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10)

/** Average + count per book, visible reviews only. One query for a whole shelf. */
export async function ratingsFor(ebookIds: number[]): Promise<Map<number, RatingSummary>> {
  const out = new Map<number, RatingSummary>()
  if (ebookIds.length === 0) return out
  try {
    const rows = await reviewDb().groupBy({
      by: ['ebookId'],
      where: { ebookId: { in: ebookIds }, hidden: false },
      _avg: { rating: true },
      _count: { _all: true },
    })
    for (const r of rows) out.set(r.ebookId, { average: round1(r._avg?.rating), count: r._count?._all ?? 0 })
  } catch {
    /* no reviews table yet → every book simply shows no rating */
  }
  return out
}

/** A reviewer as the public sees them: "Priya S." — never the full surname. */
export function reviewerName(u?: { name: string; surname: string | null }): string {
  if (!u) return 'Reader'
  const initial = u.surname?.trim()?.[0]
  return initial ? `${u.name} ${initial.toUpperCase()}.` : u.name
}

export class ReviewError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

async function publishedBook(slug: string) {
  const book = await bookDb().findFirst({
    where: { slug, status: 'published' },
    select: { id: true, authorId: true, title: true, slug: true, status: true },
  })
  if (!book) throw new ReviewError(404, 'Book not found')
  return book
}

/**
 * Whether this viewer may review, and why not if they may not. Returned to
 * the page so the button can say "Read half the book to review it" instead
 * of appearing and then failing.
 */
async function eligibility(book: { id: number; authorId: number }, viewerId?: number) {
  if (!viewerId) return { canReview: false, reason: 'signin' as const, percent: 0 }
  if (viewerId === book.authorId) return { canReview: false, reason: 'author' as const, percent: 100 }
  const progress = await progressDb().findUnique({ where: { userId_ebookId: { userId: viewerId, ebookId: book.id } } })
  const percent = progress?.percent ?? 0
  if (percent < REVIEW_MIN_PERCENT) return { canReview: false, reason: 'read_more' as const, percent }
  return { canReview: true, reason: null, percent }
}

const publicReview = (r: ReviewRow) => ({
  id: r.id,
  rating: r.rating,
  body: r.body,
  authorReply: r.authorReply,
  createdAt: r.createdAt,
  edited: r.updatedAt.getTime() - r.createdAt.getTime() > 60_000,
  reviewer: reviewerName(r.user),
})

/** The reviews panel on a book page. */
export async function listReviews(slug: string, viewerId?: number) {
  const book = await publishedBook(slug)
  const [rows, dist, elig, mine] = await Promise.all([
    reviewDb().findMany({
      where: { ebookId: book.id, hidden: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { name: true, surname: true } } },
    }),
    reviewDb().groupBy({ by: ['rating'], where: { ebookId: book.id, hidden: false }, _count: { _all: true } }),
    eligibility(book, viewerId),
    viewerId
      ? reviewDb().findUnique({ where: { ebookId_userId: { ebookId: book.id, userId: viewerId } } })
      : Promise.resolve(null),
  ])
  const distribution = [1, 2, 3, 4, 5].map((star) => dist.find((d) => d.rating === star)?._count?._all ?? 0)
  const count = distribution.reduce((a, b) => a + b, 0)
  const average = count ? round1(distribution.reduce((sum, n, i) => sum + n * (i + 1), 0) / count) : null
  return {
    summary: { average, count, distribution },
    reviews: (rows ?? []).map(publicReview),
    mine: mine ? { rating: mine.rating, body: mine.body, hidden: mine.hidden } : null,
    ...elig,
    minPercent: REVIEW_MIN_PERCENT,
  }
}

/** Create or edit the viewer's one review of this book. */
export async function saveReview(slug: string, userId: number, input: { rating: number; body?: string | null }) {
  const book = await publishedBook(slug)
  const elig = await eligibility(book, userId)
  if (!elig.canReview) {
    throw new ReviewError(
      403,
      elig.reason === 'author'
        ? 'You cannot review your own book.'
        : `Read at least ${REVIEW_MIN_PERCENT}% of the book before reviewing it.`,
    )
  }
  const body = input.body?.trim() || null
  // Editing keeps `hidden` as moderation left it: re-saving a hidden review
  // must not be a way to un-hide it.
  await reviewDb().upsert({
    where: { ebookId_userId: { ebookId: book.id, userId } },
    update: { rating: input.rating, body },
    create: { ebookId: book.id, userId, rating: input.rating, body },
  })
  return listReviews(slug, userId)
}

export async function deleteReview(slug: string, userId: number) {
  const book = await publishedBook(slug)
  const mine = await reviewDb().findUnique({ where: { ebookId_userId: { ebookId: book.id, userId } } })
  if (mine) await reviewDb().delete({ where: { id: mine.id } })
  return listReviews(slug, userId)
}

/** The author's one public answer to a review of their own book. */
export async function replyToReview(authorId: number, reviewId: number, reply: string | null) {
  const review = await reviewDb().findFirst({
    where: { id: reviewId },
    include: { ebook: { select: { authorId: true } } },
  }) as (ReviewRow & { ebook?: { authorId: number } }) | null
  // 404 for someone else's book too: "exists but not yours" is itself a leak.
  if (!review || review.ebook?.authorId !== authorId) throw new ReviewError(404, 'Review not found')
  await reviewDb().update({ where: { id: reviewId }, data: { authorReply: reply?.trim() || null } })
  return { ok: true }
}

// ---- Author dashboard ------------------------------------------------------------

export const DASHBOARD_DAYS = 30

/**
 * Per-book numbers for the author's own books, over the last 30 days, plus
 * all-time readers and ratings. Only ever scoped by `authorId` — there is no
 * code path that returns another author's figures.
 */
export async function authorDashboard(authorId: number) {
  const books = await bookDb().findMany({
    where: { authorId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, slug: true, status: true, pricePence: true, publishedAt: true },
  })
  const ids = books.map((b) => b.id)
  const since = dayOf(new Date(Date.now() - (DASHBOARD_DAYS - 1) * 86_400_000))

  const [stats, progress, ratings, recent] = ids.length
    ? await Promise.all([
        statDb().findMany({ where: { ebookId: { in: ids }, day: { gte: since } } }).catch(() => []),
        progressDb().findMany({ where: { ebookId: { in: ids } }, select: { ebookId: true, percent: true } }).catch(() => []),
        ratingsFor(ids),
        reviewDb().findMany({
          where: { ebookId: { in: ids }, hidden: false },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { user: { select: { name: true, surname: true } }, ebook: { select: { title: true, slug: true } } },
        }).catch(() => [] as ReviewRow[]),
      ])
    : [[], [], new Map<number, RatingSummary>(), [] as ReviewRow[]]

  // Daily series, zero-filled so the chart has no gaps.
  const days: string[] = []
  for (let i = 0; i < DASHBOARD_DAYS; i++) days.push(new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10))
  const series = days.map((d) => ({ day: d, pageViews: 0, sampleReads: 0, chapterReads: 0 }))
  const byDay = new Map(series.map((s) => [s.day, s]))

  const perBook = new Map(ids.map((id) => [id, { pageViews: 0, sampleReads: 0, chapterReads: 0 }]))
  for (const s of stats) {
    const b = perBook.get(s.ebookId)
    if (b) { b.pageViews += s.pageViews; b.sampleReads += s.sampleReads; b.chapterReads += s.chapterReads }
    const d = byDay.get(new Date(s.day).toISOString().slice(0, 10))
    if (d) { d.pageViews += s.pageViews; d.sampleReads += s.sampleReads; d.chapterReads += s.chapterReads }
  }

  const readers = new Map<number, { readers: number; finished: number; percentSum: number }>()
  for (const p of progress) {
    const r = readers.get(p.ebookId) ?? { readers: 0, finished: 0, percentSum: 0 }
    r.readers++
    r.percentSum += p.percent
    if (p.percent >= FINISHED_PERCENT) r.finished++
    readers.set(p.ebookId, r)
  }

  const rows = books.map((b) => {
    const s = perBook.get(b.id)!
    const r = readers.get(b.id)
    return {
      id: b.id,
      title: b.title,
      slug: b.slug,
      status: b.status,
      pricePence: b.pricePence,
      publishedAt: b.publishedAt,
      last30: s,
      readers: r?.readers ?? 0,
      finished: r?.finished ?? 0,
      avgPercent: r && r.readers ? Math.round(r.percentSum / r.readers) : 0,
      rating: ratings.get(b.id) ?? { average: null, count: 0 },
    }
  })

  const totalReviews = rows.reduce((n, b) => n + b.rating.count, 0)
  const weighted = rows.reduce((n, b) => n + (b.rating.average ?? 0) * b.rating.count, 0)
  return {
    days: DASHBOARD_DAYS,
    totals: {
      pageViews: rows.reduce((n, b) => n + b.last30.pageViews, 0),
      sampleReads: rows.reduce((n, b) => n + b.last30.sampleReads, 0),
      readers: rows.reduce((n, b) => n + b.readers, 0),
      finished: rows.reduce((n, b) => n + b.finished, 0),
      rating: { average: totalReviews ? round1(weighted / totalReviews) : null, count: totalReviews },
      // Sales do not exist yet. Present and honest rather than absent, so the
      // dashboard's shape does not change the day they do.
      earningsPence: 0,
    },
    series,
    books: rows,
    recentReviews: recent.map((r) => ({ ...publicReview(r), id: r.id, book: r.ebook ?? null })),
  }
}

/** One author's rating across every published book — for the author box. */
export async function authorRating(authorId: number): Promise<RatingSummary> {
  try {
    const books = await bookDb().findMany({ where: { authorId, status: 'published' }, select: { id: true } })
    const map = await ratingsFor(books.map((b) => b.id))
    let count = 0, sum = 0
    for (const r of map.values()) { count += r.count; sum += (r.average ?? 0) * r.count }
    return { average: count ? round1(sum / count) : null, count }
  } catch {
    return { average: null, count: 0 }
  }
}
