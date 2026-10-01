// Buying books: buy once, own forever; 70/30; no gateway yet (owner test mode).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { isMailConfigured, sendMail } from '../src/config/mailer.js'
import { availabilityFor, splitPence, markPaid, canReadAll, AUTHOR_SHARE_PERCENT } from '../src/modules/ebooks/purchases.service.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

const book = (over: Record<string, unknown> = {}) => ({ id: 7, slug: 'playing-out', title: 'Playing Out', pricePence: 999, authorId: 50, clubId: null, ...over })
let role = 'user'

function caller(id = 1) {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const a = args as { where?: { id?: number }; select?: Record<string, unknown> } | undefined
    const keys = Object.keys(a?.select ?? {})
    if (keys.length && keys.every((k) => k === 'role' || k === 'accountType')) return Promise.resolve({ role, accountType: 'coach' } as never)
    return Promise.resolve({ id, name: 'Priya', email: 'priya@test.dev', role } as never)
  })
}

async function post(url: string, payload?: unknown) {
  const app = await getApp()
  return app.inject({ method: 'POST', url, headers: authHeaders(await accessToken()), payload: payload as never })
}

beforeEach(() => {
  vi.clearAllMocks()
  role = 'user'
  caller()
  vi.mocked(isMailConfigured).mockReturnValue(true)
  vi.mocked(sendMail).mockResolvedValue(undefined)
  mock.ebook.findFirst.mockResolvedValue(book())
  mock.ebookPurchase.findFirst.mockResolvedValue(null)
  mock.ebookPurchase.create.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: 11, ...a.data }))
  mock.ebookPurchase.update.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: 11, ...a.data }))
  mock.ebookPurchase.findUnique.mockResolvedValue({
    id: 11, status: 'pending', pricePence: 999, currency: 'GBP',
    ebook: { title: 'Playing Out', slug: 'playing-out' }, user: { id: 1, name: 'Priya', email: 'priya@test.dev' },
  })
})

describe('the rules', () => {
  it('splits 70/30 in whole pence, the rounding going to the author', () => {
    expect(AUTHOR_SHARE_PERCENT).toBe(70)
    expect(splitPence(999)).toEqual({ authorSharePence: 699, platformSharePence: 300 })
    expect(splitPence(1)).toEqual({ authorSharePence: 1, platformSharePence: 0 })
  })

  it('with no gateway: "soon" for everyone, test mode for the owner', () => {
    expect(availabilityFor('user')).toBe('soon')
    expect(availabilityFor(null)).toBe('soon')
    expect(availabilityFor('owner')).toBe('test')
  })
})

describe('POST /api/ebooks/:slug/checkout', () => {
  it('tells a normal reader buying opens soon, and records nothing', async () => {
    const res = await post('/api/ebooks/playing-out/checkout', { consent: true })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('coming_soon')
    expect(mock.ebookPurchase.create).not.toHaveBeenCalled()
  })

  it('lets the owner complete a test purchase: paid, split recorded, receipt sent', async () => {
    role = 'owner'
    const res = await post('/api/ebooks/playing-out/checkout', { consent: true })
    expect(res.json()).toEqual({ status: 'paid', slug: 'playing-out' })
    expect(mock.ebookPurchase.create.mock.calls[0][0].data).toMatchObject({ ebookId: 7, userId: 1, status: 'pending', pricePence: 999, provider: 'test' })
    expect(mock.ebookPurchase.create.mock.calls[0][0].data.consentAt).toBeInstanceOf(Date)
    const paid = mock.ebookPurchase.update.mock.calls.at(-1)![0].data
    expect(paid).toMatchObject({ status: 'paid', authorSharePercent: 70, authorSharePence: 699, platformSharePence: 300 })
    await vi.waitFor(() => expect(vi.mocked(sendMail).mock.calls.some((c) => c[0].kind === 'book_receipt')).toBe(true))
  })

  it('needs the digital-content consent', async () => {
    role = 'owner'
    const res = await post('/api/ebooks/playing-out/checkout', { consent: false })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('consent')
  })

  it('refuses: already owned, free, your own book, a club book', async () => {
    role = 'owner'
    mock.ebookPurchase.findFirst.mockResolvedValue({ id: 3, status: 'paid' })
    expect((await post('/api/ebooks/playing-out/checkout', { consent: true })).json().error).toBe('owned')
    mock.ebookPurchase.findFirst.mockResolvedValue(null)
    mock.ebook.findFirst.mockResolvedValue(book({ pricePence: 0 }))
    expect((await post('/api/ebooks/playing-out/checkout', { consent: true })).json().error).toBe('free')
    mock.ebook.findFirst.mockResolvedValue(book({ authorId: 1 }))
    expect((await post('/api/ebooks/playing-out/checkout', { consent: true })).json().error).toBe('own_book')
    mock.ebook.findFirst.mockResolvedValue(book({ clubId: 4 }))
    expect((await post('/api/ebooks/playing-out/checkout', { consent: true })).statusCode).toBe(404)
  })

  it('reuses the one row per reader per book (e.g. buying again after a refund)', async () => {
    role = 'owner'
    mock.ebookPurchase.findFirst.mockResolvedValue({ id: 11, status: 'refunded' })
    await post('/api/ebooks/playing-out/checkout', { consent: true })
    expect(mock.ebookPurchase.create).not.toHaveBeenCalled()
    expect(mock.ebookPurchase.update.mock.calls[0][0].data).toMatchObject({ status: 'pending', refundedAt: null })
  })
})

describe('owning a book opens it', () => {
  it('a paid purchase, the author and a co-author read everything; a refund closes it', async () => {
    const b = { id: 7, authorId: 50, pricePence: 999 }
    mock.ebookPurchase.findFirst.mockResolvedValue({ id: 1 })
    expect(await canReadAll(b, 1)).toBe(true)
    mock.ebookPurchase.findFirst.mockResolvedValue(null)
    expect(await canReadAll(b, 1)).toBe(false)
    expect(await canReadAll(b, 50)).toBe(true)
    mock.ebookCoauthor.findFirst.mockResolvedValue({ id: 2 })
    expect(await canReadAll(b, 1)).toBe(true)
    expect(await canReadAll({ ...b, pricePence: 0 }, undefined)).toBe(true)
    // The query only ever counts PAID rows: refunded and pending do not open it.
    expect(mock.ebookPurchase.findFirst.mock.calls[0][0].where).toMatchObject({ status: 'paid' })
  })

  it('the chapter route returns the full chapter to an owner instead of 402', async () => {
    mock.ebookChapter.findFirst.mockResolvedValue({
      id: 5, title: 'Two', sortOrder: 2, isSample: false, ebookId: 7,
      blocks: [{ id: 1, kind: 'text', sortOrder: 0, data: { text: 'Here is the thing' } }],
    })
    mock.ebookChapter.findMany.mockResolvedValue([{ id: 4, isSample: false }, { id: 5, isSample: false }])
    mock.ebook.findFirst.mockResolvedValue({ pricePence: 999, title: 'T', slug: 's', authorId: 50, status: 'published' })
    mock.ebookPurchase.findFirst.mockResolvedValue({ id: 1 })
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/ebooks/playing-out/c/5', headers: authHeaders(await accessToken()) })
    expect(res.statusCode).toBe(200)
    expect(res.json().blocks[0].data.text).toBe('Here is the thing')
  })
})

describe('the gateway webhook, later', () => {
  it('marking paid twice changes nothing the second time', async () => {
    expect(await markPaid(11, 'cs_1')).toBe(true)
    mock.ebookPurchase.findUnique.mockResolvedValue({ id: 11, status: 'paid' })
    expect(await markPaid(11, 'cs_1')).toBe(false)
    expect(mock.ebookPurchase.update).toHaveBeenCalledTimes(1)
  })
})

describe('waitlist and library', () => {
  it('joins the notify-me list once', async () => {
    mock.ebookWaitlist.upsert.mockResolvedValue({})
    const res = await post('/api/ebooks/playing-out/waitlist')
    expect(res.json()).toEqual({ waitlisted: true })
    expect(mock.ebookWaitlist.upsert.mock.calls[0][0].where).toEqual({ ebookId_userId: { ebookId: 7, userId: 1 } })
  })

  it('lists only paid books', async () => {
    mock.ebookPurchase.findMany.mockResolvedValue([{
      paidAt: new Date(), source: 'grant',
      ebook: { slug: 'playing-out', title: 'Playing Out', subtitle: null, cover: {}, status: 'archived', author: { name: 'Sam', surname: 'Lee' }, progress: [{ percent: 40 }] },
    }])
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/ebooks/me/library', headers: authHeaders(await accessToken()) })
    expect(res.json()[0]).toMatchObject({ slug: 'playing-out', author: 'Sam Lee', gift: true, archived: true, percent: 40 })
    expect(mock.ebookPurchase.findMany.mock.calls[0][0].where).toEqual({ userId: 1, status: 'paid' })
  })
})

describe('Admin → Orders', () => {
  beforeEach(() => { role = 'owner' })

  it('grants a book for free and emails them', async () => {
    const res = await post('/api/admin/book-orders/grant', { slug: 'playing-out', email: 'Priya@Test.dev', note: 'reviewer' })
    expect(res.statusCode).toBe(200)
    expect(mock.ebookPurchase.create.mock.calls[0][0].data).toMatchObject({ status: 'paid', source: 'grant', pricePence: 0, authorSharePence: 0, note: 'reviewer' })
    expect(dbMock.user.findUnique.mock.calls.some((c) => (c[0] as { where: { email?: string } }).where.email === 'priya@test.dev')).toBe(true)
  })

  it('refunds only a paid order, and access stops', async () => {
    mock.ebookPurchase.findUnique.mockResolvedValue({ id: 11, status: 'pending' })
    expect((await post('/api/admin/book-orders/11/refund')).statusCode).toBe(409)
    mock.ebookPurchase.findUnique.mockResolvedValue({ id: 11, status: 'paid' })
    const res = await post('/api/admin/book-orders/11/refund', { note: 'charged twice' })
    expect(res.statusCode).toBe(200)
    expect(mock.ebookPurchase.update.mock.calls[0][0].data).toMatchObject({ status: 'refunded', note: 'charged twice' })
  })

  it('totals count real sales only — not test purchases or gifts', async () => {
    mock.ebookPurchase.findMany.mockResolvedValue([])
    mock.ebookPurchase.count.mockResolvedValue(0)
    mock.ebookPurchase.aggregate.mockResolvedValue({ _sum: { pricePence: 999, authorSharePence: 699, platformSharePence: 300 }, _count: { _all: 1 } })
    mock.ebookWaitlist.count.mockResolvedValue(4)
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/book-orders', headers: authHeaders(await accessToken()) })
    expect(res.json()).toMatchObject({ totals: { sales: 1, revenuePence: 999, authorSharePence: 699 }, waitlist: 4 })
    expect(mock.ebookPurchase.aggregate.mock.calls[0][0].where).toEqual({ status: 'paid', source: 'checkout', NOT: { provider: 'test' } })
  })
})
