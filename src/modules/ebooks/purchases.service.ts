// Buying books: who owns what, checkout, the library, grants and refunds.
//
// Rules (decided 30 Sep 2026):
//   - Buy once, own forever. Books are never part of a plan.
//   - 70% of each sale to the author side (split between author and accepted
//     co-authors by their share at payout time), 30% to TactiCoach.
//   - No gateway yet (payment-provider.ts). Until there is one, buying says
//     "opens soon" with a notify-me list, and only the owner account can
//     complete test purchases to see the whole flow.

import { db } from '../../config/database.js'
import { env } from '../../config/env.js'
import { sendBookReceiptEmail } from '../../lib/emails.js'
import { bookCheckoutProvider } from './payment-provider.js'

export const AUTHOR_SHARE_PERCENT = 70

export class PurchaseError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message)
  }
}

/** Where buying stands for this viewer: live gateway, owner test mode, or not yet. */
export type Availability = 'live' | 'test' | 'soon'

export function availabilityFor(role: string | null | undefined): Availability {
  if (bookCheckoutProvider()) return 'live'
  return role === 'owner' ? 'test' : 'soon'
}

/** The author's cut and ours, in whole pence (the author side gets the rounding). */
export function splitPence(pricePence: number, percent = AUTHOR_SHARE_PERCENT) {
  const author = Math.round((pricePence * percent) / 100)
  return { authorSharePence: author, platformSharePence: pricePence - author }
}

/**
 * May this reader open every chapter of a paid book?
 * Owners (paid, not refunded), the author, accepted co-authors, and the site
 * owner (who reviews books) — nobody else.
 */
export async function canReadAll(
  book: { id: number; authorId: number; pricePence: number },
  viewer: number | undefined,
): Promise<boolean> {
  if (book.pricePence === 0) return true
  if (!viewer) return false
  if (viewer === book.authorId) return true
  const [owned, coauthor, user] = await Promise.all([
    db.ebookPurchase.findFirst({ where: { ebookId: book.id, userId: viewer, status: 'paid' }, select: { id: true } }),
    db.ebookCoauthor.findFirst({ where: { ebookId: book.id, userId: viewer, acceptedAt: { not: null } }, select: { id: true } }),
    db.user.findUnique({ where: { id: viewer }, select: { role: true } }),
  ])
  return !!owned || !!coauthor || user?.role === 'owner'
}

/** What the book page needs to show the right button. */
export async function accessFor(book: { id: number; authorId: number; pricePence: number }, viewer: number | undefined) {
  const user = viewer ? await db.user.findUnique({ where: { id: viewer }, select: { role: true } }) : null
  const [purchase, waitlisted, readAll] = await Promise.all([
    viewer
      ? db.ebookPurchase.findFirst({ where: { ebookId: book.id, userId: viewer }, select: { status: true, source: true } })
      : Promise.resolve(null),
    viewer
      ? db.ebookWaitlist.findFirst({ where: { ebookId: book.id, userId: viewer }, select: { id: true } })
      : Promise.resolve(null),
    canReadAll(book, viewer),
  ])
  return {
    free: book.pricePence === 0,
    owned: purchase?.status === 'paid',
    /** Opens every chapter, whether bought, written or reviewed. */
    readAll,
    isAuthor: !!viewer && viewer === book.authorId,
    availability: availabilityFor(user?.role),
    waitlisted: !!waitlisted,
  }
}

async function shopBook(slug: string) {
  const book = await db.ebook.findFirst({
    where: { slug, status: 'published' },
    select: { id: true, slug: true, title: true, pricePence: true, authorId: true, clubId: true },
  })
  // Club books are never sold: they belong to the club.
  if (!book || book.clubId) throw new PurchaseError(404, 'not_found', 'Book not found.')
  return book
}

/**
 * Start buying. Returns where to go next:
 *   { status: 'paid' }        — owner test purchase, done
 *   { status: 'redirect', url } — the gateway's hosted checkout
 * or refuses with a PurchaseError ('coming_soon', 'owned', 'free', 'own_book',
 * 'consent').
 */
export async function startCheckout(userId: number, slug: string, consent: boolean) {
  const book = await shopBook(slug)
  if (book.pricePence === 0) throw new PurchaseError(409, 'free', 'This book is free — just start reading.')
  if (book.authorId === userId) throw new PurchaseError(409, 'own_book', 'This is your book, so it is already open to you.')
  if (!consent) {
    throw new PurchaseError(422, 'consent', 'Please confirm you want access straight away.')
  }
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true } })
  if (!user) throw new PurchaseError(404, 'not_found', 'Account not found.')

  const existing = await db.ebookPurchase.findFirst({ where: { ebookId: book.id, userId } })
  if (existing?.status === 'paid') throw new PurchaseError(409, 'owned', 'You already own this book.')

  const availability = availabilityFor(user.role)
  if (availability === 'soon') {
    throw new PurchaseError(409, 'coming_soon', 'Buying books opens soon. We can email you when it does.')
  }

  // One row per reader per book: a second attempt (or a refunded reader
  // buying again) reuses it at today's price.
  const data = {
    status: 'pending' as const,
    source: 'checkout' as const,
    pricePence: book.pricePence,
    currency: 'GBP',
    consentAt: new Date(),
    refundedAt: null,
    provider: availability === 'test' ? 'test' : bookCheckoutProvider()!.name,
  }
  const purchase = existing
    ? await db.ebookPurchase.update({ where: { id: existing.id }, data })
    : await db.ebookPurchase.create({ data: { ...data, ebookId: book.id, userId } })

  if (availability === 'test') {
    await markPaid(purchase.id, `test_${purchase.id}_${Date.now()}`)
    return { status: 'paid' as const, slug: book.slug }
  }

  const provider = bookCheckoutProvider()!
  const back = `${env.FRONTEND_URL}/books/${encodeURIComponent(book.slug)}`
  const { url, ref } = await provider.createCheckout({
    purchaseId: purchase.id,
    amountPence: book.pricePence,
    currency: 'GBP',
    title: book.title,
    customerEmail: user.email,
    successUrl: `${back}/bought`,
    cancelUrl: back,
  })
  await db.ebookPurchase.update({ where: { id: purchase.id }, data: { providerRef: ref } })
  return { status: 'redirect' as const, url }
}

/**
 * The money has cleared (the gateway's webhook, or a test purchase). The
 * split is fixed here, on the row, so a later change to it never restates a
 * sale. Idempotent: a webhook delivered twice changes nothing the second time.
 */
export async function markPaid(purchaseId: number, providerRef: string): Promise<boolean> {
  const purchase = await db.ebookPurchase.findUnique({
    where: { id: purchaseId },
    include: { ebook: { select: { title: true, slug: true } }, user: { select: { id: true, name: true, email: true } } },
  })
  if (!purchase || purchase.status === 'paid') return false
  const paidAt = new Date()
  await db.ebookPurchase.update({
    where: { id: purchaseId },
    data: {
      status: 'paid',
      paidAt,
      providerRef,
      authorSharePercent: AUTHOR_SHARE_PERCENT,
      ...splitPence(purchase.pricePence),
    },
  })
  void sendBookReceiptEmail({
    user: purchase.user, book: purchase.ebook, pricePence: purchase.pricePence,
    currency: purchase.currency, orderId: purchase.id, paidAt, granted: false,
  })
  return true
}

/** "Tell me when I can buy this." Idempotent. */
export async function joinWaitlist(userId: number, slug: string) {
  const book = await shopBook(slug)
  await db.ebookWaitlist.upsert({
    where: { ebookId_userId: { ebookId: book.id, userId } },
    update: {},
    create: { ebookId: book.id, userId },
  })
  return { waitlisted: true }
}

/** The books this reader owns, newest first. */
export async function library(userId: number) {
  const rows = await db.ebookPurchase.findMany({
    where: { userId, status: 'paid' },
    orderBy: { paidAt: 'desc' },
    select: {
      paidAt: true, source: true,
      ebook: {
        select: {
          slug: true, title: true, subtitle: true, cover: true, status: true, category: true, ageBand: true,
          author: { select: { name: true, surname: true } },
          progress: { where: { userId }, select: { percent: true }, take: 1 },
        },
      },
    },
  })
  return rows.map((r) => ({
    slug: r.ebook.slug,
    title: r.ebook.title,
    subtitle: r.ebook.subtitle,
    cover: r.ebook.cover,
    category: r.ebook.category,
    ageBand: r.ebook.ageBand,
    author: [r.ebook.author.name, r.ebook.author.surname].filter(Boolean).join(' '),
    ownedSince: r.paidAt,
    gift: r.source === 'grant',
    /** Archived = taken out of the shop. Still theirs to read (getChapter allows it). */
    archived: r.ebook.status === 'archived',
    percent: r.ebook.progress[0]?.percent ?? 0,
  }))
}

// ---- Admin -------------------------------------------------------------------

/** Give a book to somebody for free: a reviewer, a competition prize, a test. */
export async function grantBook(adminId: number, params: { slug: string; email: string; note?: string | null }) {
  const book = await shopBook(params.slug)
  const user = await db.user.findUnique({
    where: { email: params.email.trim().toLowerCase() },
    select: { id: true, name: true, email: true },
  })
  if (!user) throw new PurchaseError(404, 'no_user', 'No account with that email.')
  const existing = await db.ebookPurchase.findFirst({ where: { ebookId: book.id, userId: user.id } })
  if (existing?.status === 'paid') throw new PurchaseError(409, 'owned', 'They already own this book.')
  const data = {
    status: 'paid' as const, source: 'grant' as const, pricePence: 0, currency: 'GBP',
    authorSharePercent: AUTHOR_SHARE_PERCENT, authorSharePence: 0, platformSharePence: 0,
    provider: null, providerRef: null, paidAt: new Date(), refundedAt: null,
    grantedById: adminId, note: params.note?.trim() || null,
  }
  const row = existing
    ? await db.ebookPurchase.update({ where: { id: existing.id }, data })
    : await db.ebookPurchase.create({ data: { ...data, ebookId: book.id, userId: user.id } })
  void sendBookReceiptEmail({
    user, book, pricePence: 0, currency: 'GBP', orderId: row.id, paidAt: data.paidAt, granted: true,
  })
  return row
}

/**
 * Take a book back. Access stops at once. The money itself is returned in
 * the gateway (or by hand while there is none); this records it.
 */
export async function refundPurchase(id: number, note?: string | null) {
  const row = await db.ebookPurchase.findUnique({ where: { id } })
  if (!row) throw new PurchaseError(404, 'not_found', 'Order not found.')
  if (row.status !== 'paid') throw new PurchaseError(409, 'not_paid', 'Only a paid order can be refunded.')
  return db.ebookPurchase.update({
    where: { id },
    data: { status: 'refunded', refundedAt: new Date(), ...(note ? { note: note.slice(0, 255) } : {}) },
  })
}

export async function listOrders(params: { status?: string; q?: string; page?: number; limit?: number }) {
  const limit = Math.min(100, params.limit ?? 25)
  const page = Math.max(1, params.page ?? 1)
  const status = ['pending', 'paid', 'refunded'].includes(params.status ?? '') ? params.status as 'paid' : undefined
  const q = params.q?.trim()
  const where = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ user: { email: { contains: q } } }, { ebook: { title: { contains: q } } }] } : {}),
  }
  const [rows, total, sums, waitlist] = await Promise.all([
    db.ebookPurchase.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
      select: {
        id: true, status: true, source: true, pricePence: true, currency: true,
        authorSharePence: true, platformSharePence: true, provider: true,
        paidAt: true, refundedAt: true, createdAt: true, note: true,
        user: { select: { id: true, name: true, surname: true, email: true } },
        ebook: { select: { slug: true, title: true, author: { select: { name: true, surname: true } } } },
      },
    }),
    db.ebookPurchase.count({ where }),
    // Real sales only — test purchases and gifts are not revenue.
    db.ebookPurchase.aggregate({
      where: { status: 'paid', source: 'checkout', NOT: { provider: 'test' } },
      _sum: { pricePence: true, authorSharePence: true, platformSharePence: true },
      _count: { _all: true },
    }),
    db.ebookWaitlist.count({ where: { notifiedAt: null } }),
  ])
  return {
    rows,
    total,
    totals: {
      sales: sums._count._all,
      revenuePence: sums._sum.pricePence ?? 0,
      authorSharePence: sums._sum.authorSharePence ?? 0,
      platformSharePence: sums._sum.platformSharePence ?? 0,
    },
    /** Readers waiting to be told buying is open. */
    waitlist,
  }
}
