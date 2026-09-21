// Ebooks: the shop, and reading one.
//
// The rule that shapes every query here: NOTHING returns a whole book. The
// shop returns covers and metadata, the book page returns chapter titles, and
// reading returns ONE chapter's blocks. There is deliberately no endpoint that
// hands back the text of everything — because if one existed, "the book cannot
// be downloaded" would be a sentence in the marketing rather than a fact about
// the software.

import { db } from '../../config/database.js'
import { presignUrl } from '../../config/s3.js'

// ---- TEMPORARY: remove once `prisma generate` has run against migration 28 --
// The generated client has no ebook delegates until then. Narrow on purpose.

/**
 * Fetch a delegate, or say plainly why it is missing.
 *
 * Without this, a client generated before migration 28 makes `db.ebook`
 * undefined and the first call dies with "Cannot read properties of undefined
 * (reading 'findMany')". The error handler masks every 500 — correctly, since
 * driver messages name tables and hosts — so what actually reaches the screen
 * is a bare "Internal Server Error" with no hint that the fix is two commands.
 *
 * 503 rather than 500 because the handler keeps the message on a deliberate
 * 5xx, and because that is what this is: the service is not ready yet, and it
 * will be as soon as the client is regenerated. Nothing internal is leaked —
 * the text names our own build steps, not the database.
 */
function delegate<T>(name: string): T {
  const found = (db as unknown as Record<string, unknown>)[name]
  if (!found) {
    const error = new Error(
      'Ebooks are not available on this deployment yet. Run "npx prisma migrate deploy" ' +
      'and "npx prisma generate" in the API, then restart it.',
    ) as Error & { statusCode: number }
    error.statusCode = 503
    throw error
  }
  return found as T
}

interface EbookRow {
  id: number
  authorId: number
  submittedAt?: Date | null
  reviewNote?: string | null
  title: string
  subtitle: string | null
  slug: string
  blurb: string | null
  category: string
  ageBand: string
  cover: unknown
  status: string
  publishedAt: Date | null
  pricePence: number
  language: string
  createdAt: Date
  updatedAt: Date
  author?: { name: string; surname: string | null; clubName?: string | null; clubLogoKey?: string | null }
  chapters?: {
    id: number
    title: string
    sortOrder: number
    isSample: boolean
    // `adminGet` really does select these. Leaving them off the shim made the
    // authoring payload look empty to anything reading the type.
    blocks?: { id: number; kind: string; sortOrder: number; data: unknown }[]
    _count?: { blocks: number }
  }[]
  _count?: { chapters: number }
}
interface ChapterRow {
  id: number
  ebookId: number
  title: string
  sortOrder: number
  isSample: boolean
  blocks?: { id: number; kind: string; sortOrder: number; data: unknown }[]
}
const ebookDb = () =>
  delegate<{
    findMany(a?: unknown): Promise<EbookRow[]>
    findFirst(a?: unknown): Promise<EbookRow | null>
    create(a: unknown): Promise<EbookRow>
    update(a: unknown): Promise<EbookRow>
    delete(a: unknown): Promise<EbookRow>
    count(a?: unknown): Promise<number>
  }>('ebook')
const chapterDb = () =>
  delegate<{
    findFirst(a?: unknown): Promise<ChapterRow | null>
    findMany(a?: unknown): Promise<(ChapterRow & { _count?: { blocks: number } })[]>
    create(a: unknown): Promise<ChapterRow>
    update(a: unknown): Promise<ChapterRow>
    delete(a: unknown): Promise<ChapterRow>
  }>('ebookChapter')
const blockDb = () =>
  delegate<{
    create(a: unknown): Promise<unknown>
    deleteMany(a: unknown): Promise<{ count: number }>
  }>('ebookBlock')
const progressDb = () =>
  delegate<{
    findUnique(a: unknown): Promise<{ percent: number; lastChapterId: number | null } | null>
    upsert(a: unknown): Promise<unknown>
  }>('ebookProgress')

export const CATEGORIES = ['tactics', 'technique', 'mindset', 'goalkeeping', 'fitness', 'set_pieces'] as const
export const AGE_BANDS = ['u9_11', 'u12_14', 'u15_18', 'adult', 'all'] as const
export const BLOCK_KINDS = [
  'text', 'board', 'board_compare', 'board_sequence', 'drill',
  'character', 'your_turn', 'quiz', 'image', 'quote',
] as const

const authorName = (a?: { name: string; surname: string | null }) =>
  a ? [a.name, a.surname].filter(Boolean).join(' ') : ''

/**
 * The author's club badge, ready for the cover.
 *
 * Presigned per request rather than stored, like every other upload here. The
 * cover shows it ALONGSIDE our mark and never instead of it — a book is
 * published under the TactiCoach imprint whoever wrote it.
 *
 * Returns null when the coach has no badge, and also when object storage is
 * misconfigured, which on production it currently is. A cover renders without
 * one rather than leaving a gap where one would go.
 */
const authorLogo = (a?: { clubLogoKey?: string | null }): Promise<string | null> =>
  a?.clubLogoKey ? presignUrl(a.clubLogoKey).catch(() => null) : Promise.resolve(null)

/** One presign per distinct key, not one per book — a shop page repeats authors. */
async function logosFor(
  rows: { author?: { clubLogoKey?: string | null } }[],
): Promise<Map<string, string | null>> {
  const keys = [...new Set(rows.map((r) => r.author?.clubLogoKey).filter((k): k is string => !!k))]
  const urls = await Promise.all(keys.map((k) => presignUrl(k).catch(() => null)))
  return new Map(keys.map((k, i) => [k, urls[i]]))
}

export interface ShopFilters {
  category?: string
  ageBand?: string
  sort?: 'best' | 'new' | 'rated'
  q?: string
}

/**
 * The shop.
 *
 * Only `published` books, always — a draft is the author's private workspace
 * and a bug that listed one would publish something nobody meant to publish.
 * That is pinned by a test rather than left to this comment.
 */
export async function listBooks(filters: ShopFilters) {
  const books = await ebookDb().findMany({
    where: {
      status: 'published',
      ...(filters.category && CATEGORIES.includes(filters.category as 'tactics')
        ? { category: filters.category }
        : {}),
      // `all` means the book suits every age, so it must appear under every
      // age filter rather than only under its own.
      ...(filters.ageBand && AGE_BANDS.includes(filters.ageBand as 'all')
        ? { ageBand: { in: [filters.ageBand, 'all'] } }
        : {}),
      ...(filters.q?.trim() ? { title: { contains: filters.q.trim() } } : {}),
    },
    orderBy: filters.sort === 'new' ? { publishedAt: 'desc' } : { publishedAt: 'desc' },
    take: 120,
    select: {
      id: true, title: true, subtitle: true, slug: true, category: true, ageBand: true,
      cover: true, pricePence: true, publishedAt: true,
      author: { select: { name: true, surname: true, clubName: true, clubLogoKey: true } },
      _count: { select: { chapters: true } },
    },
  })

  const logos = await logosFor(books)

  return books.map((b) => ({
    id: b.id,
    slug: b.slug,
    title: b.title,
    subtitle: b.subtitle,
    category: b.category,
    ageBand: b.ageBand,
    cover: b.cover,
    pricePence: b.pricePence,
    chapters: b._count?.chapters ?? 0,
    author: authorName(b.author),
    authorLogoUrl: b.author?.clubLogoKey ? logos.get(b.author.clubLogoKey) ?? null : null,
    // Ratings and sales do not exist yet, so this is honestly false for
    // everything rather than randomly decorated. When sales land it becomes
    // top 10% by copies in 30 days, past a minimum floor — computed, never
    // set by an author.
    bestSeller: false,
  }))
}

/**
 * One book's page: the cover, the blurb, and the chapter LIST.
 *
 * Chapter titles only. No block ever crosses this boundary, so the book page
 * cannot be scraped for the text.
 */
export async function getBook(slug: string) {
  const book = await ebookDb().findFirst({
    where: { slug, status: 'published' },
    select: {
      id: true, title: true, subtitle: true, slug: true, blurb: true, category: true,
      ageBand: true, cover: true, pricePence: true, language: true, publishedAt: true,
      author: { select: { name: true, surname: true, clubName: true, clubLogoKey: true } },
      chapters: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, title: true, sortOrder: true, isSample: true },
      },
    },
  })
  if (!book) return null
  return {
    ...book,
    author: authorName(book.author),
    authorLogoUrl: await authorLogo(book.author),
    club: book.author?.clubName ?? null,
  }
}

/**
 * One chapter's blocks. This is the only thing that returns readable content.
 *
 * `free` books are open to any signed-in reader; on a paid book only chapters
 * flagged `isSample` are readable until purchasing exists. Deliberately
 * conservative: it is much easier to open a door later than to explain why a
 * paid book was readable for a fortnight.
 */
export async function getChapter(slug: string, chapterId: number) {
  const chapter = await chapterDb().findFirst({
    where: { id: chapterId, ebook: { slug, status: 'published' } },
    select: {
      id: true, title: true, sortOrder: true, isSample: true, ebookId: true,
      blocks: { orderBy: { sortOrder: 'asc' }, select: { id: true, kind: true, sortOrder: true, data: true } },
    },
  })
  if (!chapter) return null

  const book = await ebookDb().findFirst({
    where: { id: chapter.ebookId },
    select: { pricePence: true, title: true, slug: true },
  })
  const readable = (book?.pricePence ?? 0) === 0 || chapter.isSample
  if (!readable) return { locked: true as const, title: chapter.title }

  return { locked: false as const, ...chapter }
}

/** Every chapter of a book, titles only — the reader's own contents list. */
export async function getContents(slug: string) {
  return chapterDb().findMany({
    where: { ebook: { slug, status: 'published' } },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, title: true, sortOrder: true, isSample: true },
  })
}

export async function getProgress(userId: number, ebookId: number) {
  return progressDb().findUnique({ where: { userId_ebookId: { userId, ebookId } } })
}

export async function saveProgress(
  userId: number, ebookId: number, chapterId: number, percent: number,
) {
  // Clamped here rather than trusted: percent arrives from a client.
  const pct = Math.max(0, Math.min(100, Math.round(percent)))
  await progressDb().upsert({
    where: { userId_ebookId: { userId, ebookId } },
    update: { lastChapterId: chapterId, percent: pct },
    create: { userId, ebookId, lastChapterId: chapterId, percent: pct },
  })
}

// ---- Authoring (admin only, for now) ----------------------------------------

/** URL-safe, unique. Two books called "Scanning" must not fight over a slug. */
export async function uniqueSlug(title: string, excludeId?: number): Promise<string> {
  const base =
    title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150) || 'book'
  // Bounded. An unbounded `for (;;)` here is one bad query away from a request
  // that never returns and a process that runs out of memory building strings —
  // which is exactly what it did, under a test whose mock answered "taken" to
  // every slug. Fifty real collisions on one title is already absurd; past
  // that, take the random suffix and move on.
  for (let i = 1; i <= 50; i++) {
    const slug = i === 1 ? base : `${base}-${i}`
    const clash = await ebookDb().findFirst({
      where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    })
    if (!clash) return slug
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * The authoring list.
 *
 * Flattened exactly like `listBooks` — `author` a string, `chapters` a number.
 * The editor renders the SAME BookCover component as the shop, so it must be
 * handed the same shape; leaving admin on the raw Prisma shape meant a nested
 * `{name, surname}` where the component wanted a line of text, and a book that
 * looked fine in the shop and broken in the screen used to build it.
 */
/**
 * The authoring list.
 *
 * `authorId` is not optional by accident: pass it for a COACH (their own
 * books) and omit it only for the owner's review queue. It used to take no
 * argument at all and return every book in the table — safe while a single
 * owner was the only author, and a cross-author leak the moment coaches could
 * reach it. Every caller now has to say whose books it wants.
 */
export async function adminList(authorId?: number, opts?: { status?: string; queue?: boolean }) {
  const books = await ebookDb().findMany({
    where: {
      ...(authorId === undefined ? {} : { authorId }),
      ...(opts?.status ? { status: opts.status } : {}),
    },
    // A review QUEUE is oldest-waiting-first: whoever has been waiting longest
    // is served first. Every other listing is most-recently-touched first,
    // which is what an author wants when they come back to finish a chapter.
    orderBy: opts?.queue ? { submittedAt: 'asc' } : { updatedAt: 'desc' },
    take: 200,
    select: {
      id: true, title: true, subtitle: true, slug: true, status: true, category: true,
      ageBand: true, cover: true, pricePence: true, publishedAt: true, updatedAt: true,
      submittedAt: true, reviewNote: true,
      author: { select: { name: true, surname: true, clubLogoKey: true } },
      _count: { select: { chapters: true } },
    },
  })
  const logos = await logosFor(books)
  return books.map((b) => ({
    id: b.id,
    slug: b.slug,
    title: b.title,
    subtitle: b.subtitle,
    status: b.status,
    category: b.category,
    ageBand: b.ageBand,
    cover: b.cover,
    pricePence: b.pricePence,
    publishedAt: b.publishedAt,
    submittedAt: b.submittedAt,
    reviewNote: b.reviewNote,
    updatedAt: b.updatedAt,
    chapters: b._count?.chapters ?? 0,
    author: authorName(b.author),
    authorLogoUrl: b.author?.clubLogoKey ? logos.get(b.author.clubLogoKey) ?? null : null,
    // Unlike the shop's card, an unpublished book has nothing to boast about.
    bestSeller: false,
  }))
}

/**
 * One book, whole — the only place blocks are returned outside the reader.
 *
 * `authorId` scopes it to that author. Omit it ONLY for the owner. Without
 * the filter this opened any book by guessing an id, which is a hole that
 * `requireOwner` was hiding rather than closing.
 */
export async function adminGet(id: number, authorId?: number) {
  const book = await ebookDb().findFirst({
    where: authorId === undefined ? { id } : { id, authorId },
    select: {
      id: true, title: true, subtitle: true, slug: true, blurb: true, category: true,
      ageBand: true, cover: true, status: true, pricePence: true, language: true,
      authorId: true, submittedAt: true, reviewNote: true,
      // Selected because PATCH /admin/ebooks/:id reads it to decide whether
      // this is the FIRST publish. Omitted, it arrived undefined and the route
      // restamped publishedAt on every save — making an edited book look new in
      // the shop, which is the one thing its comment promised would not happen.
      // The Prisma shim declares the field on the row type, so the compiler
      // could not see the hole; only selecting it fixes the behaviour.
      publishedAt: true,
      author: { select: { name: true, surname: true, clubLogoKey: true } },
      chapters: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true, title: true, sortOrder: true, isSample: true,
          blocks: { orderBy: { sortOrder: 'asc' }, select: { id: true, kind: true, sortOrder: true, data: true } },
        },
      },
    },
  })
  if (!book) return null
  return {
    ...book,
    author: authorName(book.author),
    authorLogoUrl: await authorLogo(book.author),
  }
}

export { ebookDb, chapterDb, blockDb }

// ---- Authoring, shared by the coach routes and the owner's ------------------

export interface ChapterInput {
  title: string
  isSample: boolean
  blocks: { kind: string; data: Record<string, unknown> }[]
}

/**
 * Replace a book's whole chapter tree.
 *
 * Wholesale rather than per-block CRUD: an editor holds the entire book in
 * memory and saves it, and incremental endpoints would mean reconciling order,
 * insertions and deletions across a dozen requests, each able to fail on its
 * own and leave half a chapter on screen.
 *
 * Reader notes reference chapters and blocks with ON DELETE SET NULL, so a
 * note survives its anchor being rewritten (migration 28).
 *
 * Lifted out of the admin route so the coach route runs exactly the same code.
 * Two copies of a destructive transaction is two chances to get the delete
 * order wrong.
 */
export async function replaceChapters(ebookId: number, chapters: ChapterInput[]): Promise<void> {
  const existing = await chapterDb().findMany({ where: { ebookId }, select: { id: true } })
  await db.$transaction(async () => {
    for (const ch of existing) {
      await chapterDb().delete({ where: { id: ch.id } })
    }
    for (const [ci, ch] of chapters.entries()) {
      const made = await chapterDb().create({
        data: { ebookId, title: ch.title, sortOrder: ci, isSample: ch.isSample },
      })
      for (const [bi, b] of ch.blocks.entries()) {
        await blockDb().create({
          data: { chapterId: made.id, kind: b.kind, sortOrder: bi, data: b.data as object },
        })
      }
    }
  })
}

/**
 * Does this book have anything in it?
 *
 * The gate on submitting for review. An empty book wastes a reviewer's time
 * and embarrasses its author — and "at least one chapter" is not enough,
 * because a chapter with no blocks is a title and nothing else.
 */
export async function hasContent(ebookId: number): Promise<boolean> {
  const chapters = await chapterDb().findMany({
    where: { ebookId },
    select: { id: true, _count: { select: { blocks: true } } },
  })
  return chapters.some((c) => (c._count?.blocks ?? 0) > 0)
}

/**
 * The ebook delegate, for routes that write.
 *
 * Exported rather than re-declared in the routes: the TEMPORARY shim above is
 * one lie about the generated client, and two copies of it would drift the
 * day `prisma generate` finally runs.
 */
export const ebookDelegate = ebookDb

/** Delete a book. Only ever called after an ownership check. */
export async function removeBook(id: number): Promise<void> {
  await ebookDb().delete({ where: { id } })
}
