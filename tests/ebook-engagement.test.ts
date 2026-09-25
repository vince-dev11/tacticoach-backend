// Books in public, reviews, and the author dashboard.
//
// What must never break:
//   - a stranger reads the SAMPLE and nothing else
//   - only readers who got halfway can review, one review each, never the author
//   - an author's dashboard is theirs alone
//   - counting never counts crawlers, and never counts the author's own visits

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { reviewerName, isBot, REVIEW_MIN_PERCENT } from '../src/modules/ebooks/engagement.service.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const COVER = { template: 'ball', bg: '#0b3d2e', art: '#ffffff', font: 'sans', weight: '900', style: 'normal', size: '1.55' }
const BROWSER = { 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605' }

function caller(id = 1, accountType = 'coach') {
  dbMock.user.findUnique.mockImplementation((() => Promise.resolve({ id, role: 'user', accountType } as never)) as never)
}

async function req(method: 'GET' | 'PUT' | 'DELETE' | 'POST', url: string, opts: { auth?: boolean; payload?: unknown; headers?: Record<string, string> } = {}) {
  const app = await getApp()
  const headers = { ...BROWSER, ...(opts.headers ?? {}), ...(opts.auth ? authHeaders(await accessToken()) : {}) }
  return app.inject({ method, url, headers, payload: opts.payload as never })
}

beforeEach(() => {
  vi.clearAllMocks()
  caller()
  mock.ebookReview.groupBy.mockResolvedValue([] as never)
  mock.ebookReview.findMany.mockResolvedValue([] as never)
  mock.ebookReview.findUnique.mockResolvedValue(null as never)
  mock.ebookDailyStat.upsert.mockResolvedValue({} as never)
  mock.ebookDailyStat.findMany.mockResolvedValue([] as never)
  mock.ebookProgress.findMany.mockResolvedValue([] as never)
})

describe('the shop is public', () => {
  it('lists books with no token, with a rating on each', async () => {
    mock.ebook.findMany.mockResolvedValue([{
      id: 1, slug: 's', title: 'T', subtitle: null, category: 'tactics', ageBand: 'all', cover: COVER,
      pricePence: 0, author: { name: 'A', surname: null, clubName: null }, _count: { chapters: 2 },
    }] as never)
    mock.ebookReview.groupBy.mockResolvedValue([{ ebookId: 1, _avg: { rating: 4.333 }, _count: { _all: 3 } }] as never)
    const res = await req('GET', '/api/ebooks')
    expect(res.statusCode).toBe(200)
    expect(res.json()[0].rating).toEqual({ average: 4.3, count: 3 })
  })

  it('serves a book page with no token, and counts the visit', async () => {
    mock.ebook.findFirst.mockResolvedValue({
      id: 1, slug: 'playing-out', title: 'P', subtitle: null, blurb: null, category: 'tactics', ageBand: 'all',
      cover: COVER, pricePence: 0, language: 'en', authorId: 7, author: { name: 'M', surname: 'R', clubName: null }, chapters: [],
    } as never)
    mock.ebook.findMany.mockResolvedValue([] as never)
    const res = await req('GET', '/api/ebooks/playing-out')
    expect(res.statusCode).toBe(200)
    expect(res.json().progress).toBeNull()
    expect(res.json()).not.toHaveProperty('_authorId')
    expect(mock.ebookDailyStat.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { pageViews: { increment: 1 } },
    }))
  })

  it('does not count crawlers', async () => {
    mock.ebook.findFirst.mockResolvedValue({
      id: 1, slug: 'p', title: 'P', subtitle: null, blurb: null, category: 'tactics', ageBand: 'all',
      cover: COVER, pricePence: 0, language: 'en', authorId: 7, author: { name: 'M', surname: 'R', clubName: null }, chapters: [],
    } as never)
    mock.ebook.findMany.mockResolvedValue([] as never)
    await req('GET', '/api/ebooks/p', { headers: { 'user-agent': 'Googlebot/2.1' } })
    expect(mock.ebookDailyStat.upsert).not.toHaveBeenCalled()
  })

  it('serves a sitemap of published books only', async () => {
    mock.ebook.findMany.mockResolvedValue([{ slug: 'playing-out', updatedAt: new Date('2026-09-01') }] as never)
    const res = await req('GET', '/api/ebooks/sitemap.xml')
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('/books/playing-out</loc>')
    expect(mock.ebook.findMany.mock.calls[0][0]!.where).toEqual({ status: 'published' })
  })
})

describe('reading without an account', () => {
  const chapter = (over: Record<string, unknown> = {}) => ({
    id: 5, ebookId: 1, title: 'Angles', sortOrder: 0, isSample: false,
    blocks: [{ id: 9, kind: 'text', sortOrder: 0, data: { text: 'x' } }], ...over,
  })

  it('reads the flagged sample chapter', async () => {
    mock.ebookChapter.findFirst.mockResolvedValue(chapter({ isSample: true }) as never)
    mock.ebook.findFirst.mockResolvedValue({ pricePence: 999, title: 'T', slug: 's' } as never)
    const res = await req('GET', '/api/ebooks/s/c/5')
    expect(res.statusCode).toBe(200)
    expect(res.json().blocks).toHaveLength(1)
    expect(res.json()).not.toHaveProperty('sample')
  })

  it('treats the first chapter as the sample when none is flagged', async () => {
    mock.ebookChapter.findFirst.mockResolvedValue(chapter() as never)
    mock.ebookChapter.findMany.mockResolvedValue([{ id: 5, isSample: false }, { id: 6, isSample: false }] as never)
    mock.ebook.findFirst.mockResolvedValue({ pricePence: 0, title: 'T', slug: 's' } as never)
    expect((await req('GET', '/api/ebooks/s/c/5')).statusCode).toBe(200)
  })

  it('asks a stranger to sign up past the sample — even on a FREE book', async () => {
    mock.ebookChapter.findFirst.mockResolvedValue(chapter({ id: 6, sortOrder: 1 }) as never)
    mock.ebookChapter.findMany.mockResolvedValue([{ id: 5, isSample: false }, { id: 6, isSample: false }] as never)
    mock.ebook.findFirst.mockResolvedValue({ pricePence: 0, title: 'T', slug: 's' } as never)
    const res = await req('GET', '/api/ebooks/s/c/6')
    expect(res.statusCode).toBe(401)
    expect(res.json().signupToRead).toBe(true)
    expect(res.body).not.toContain('"blocks"')
  })

  it('a signed-in reader still reads every chapter of a free book', async () => {
    mock.ebookChapter.findFirst.mockResolvedValue(chapter({ id: 6, sortOrder: 1 }) as never)
    mock.ebookChapter.findMany.mockResolvedValue([{ id: 5, isSample: false }, { id: 6, isSample: false }] as never)
    mock.ebook.findFirst.mockResolvedValue({ pricePence: 0, title: 'T', slug: 's' } as never)
    expect((await req('GET', '/api/ebooks/s/c/6', { auth: true })).statusCode).toBe(200)
  })

  it('progress still needs an account', async () => {
    expect((await req('POST', '/api/ebooks/s/progress', { payload: { chapterId: 5, percent: 50 } })).statusCode).toBe(401)
  })
})

describe('reviews', () => {
  const BOOK = { id: 1, authorId: 7, title: 'T', slug: 's', status: 'published' }

  beforeEach(() => {
    mock.ebook.findFirst.mockResolvedValue(BOOK as never)
    mock.ebookReview.upsert.mockResolvedValue({} as never)
  })

  it('refuses a reader who has not read half the book', async () => {
    mock.ebookProgress.findUnique.mockResolvedValue({ percent: REVIEW_MIN_PERCENT - 1 } as never)
    const res = await req('PUT', '/api/ebooks/s/reviews/mine', { auth: true, payload: { rating: 5 } })
    expect(res.statusCode).toBe(403)
    expect(mock.ebookReview.upsert).not.toHaveBeenCalled()
  })

  it('refuses the author reviewing their own book', async () => {
    caller(7)
    mock.ebookProgress.findUnique.mockResolvedValue({ percent: 100 } as never)
    // accessToken() signs as user 1; make the book's author the caller instead.
    mock.ebook.findFirst.mockResolvedValue({ ...BOOK, authorId: 1 } as never)
    const res = await req('PUT', '/api/ebooks/s/reviews/mine', { auth: true, payload: { rating: 5 } })
    expect(res.statusCode).toBe(403)
    expect(res.json().message).toMatch(/own book/)
  })

  it('saves one review per reader (upsert on book + user)', async () => {
    mock.ebookProgress.findUnique.mockResolvedValue({ percent: REVIEW_MIN_PERCENT } as never)
    const res = await req('PUT', '/api/ebooks/s/reviews/mine', { auth: true, payload: { rating: 4, body: '  Great drills  ' } })
    expect(res.statusCode).toBe(200)
    const call = mock.ebookReview.upsert.mock.calls[0][0]!
    expect(call.where).toEqual({ ebookId_userId: { ebookId: 1, userId: 1 } })
    expect(call.create).toMatchObject({ rating: 4, body: 'Great drills' })
    // Editing must not be a way to un-hide a moderated review.
    expect(call.update).not.toHaveProperty('hidden')
  })

  it('rejects ratings outside 1–5', async () => {
    mock.ebookProgress.findUnique.mockResolvedValue({ percent: 100 } as never)
    for (const rating of [0, 6, 3.5]) {
      expect((await req('PUT', '/api/ebooks/s/reviews/mine', { auth: true, payload: { rating } })).statusCode).toBe(422)
    }
  })

  it('lists visible reviews only, with first name + initial', async () => {
    mock.ebookReview.findMany.mockResolvedValue([{
      id: 3, ebookId: 1, userId: 2, rating: 5, body: 'Loved it', hidden: false, authorReply: null,
      createdAt: new Date(), updatedAt: new Date(), user: { name: 'Priya', surname: 'Sharma' },
    }] as never)
    mock.ebookReview.groupBy.mockResolvedValue([{ rating: 5, _count: { _all: 1 } }] as never)
    const body = (await req('GET', '/api/ebooks/s/reviews')).json()
    expect(mock.ebookReview.findMany.mock.calls[0][0]!.where).toMatchObject({ ebookId: 1, hidden: false })
    expect(body.reviews[0].reviewer).toBe('Priya S.')
    expect(JSON.stringify(body)).not.toContain('Sharma')
    expect(body.summary).toEqual({ average: 5, count: 1, distribution: [0, 0, 0, 0, 1] })
    expect(body.canReview).toBe(false)
    expect(body.reason).toBe('signin')
  })
})

describe('author dashboard', () => {
  it('is scoped to the caller and never anyone else', async () => {
    mock.ebook.findMany.mockResolvedValue([{ id: 1, title: 'T', slug: 's', status: 'published', pricePence: 0, publishedAt: new Date() }] as never)
    mock.ebookDailyStat.findMany.mockResolvedValue([{ ebookId: 1, day: new Date(), pageViews: 10, sampleReads: 4, chapterReads: 2 }] as never)
    mock.ebookProgress.findMany.mockResolvedValue([{ ebookId: 1, percent: 100 }, { ebookId: 1, percent: 20 }] as never)
    const res = await req('GET', '/api/my-books/dashboard', { auth: true })
    expect(res.statusCode).toBe(200)
    expect(mock.ebook.findMany.mock.calls[0][0]!.where).toEqual({ authorId: 1 })
    const body = res.json()
    expect(body.series).toHaveLength(30)
    expect(body.books[0]).toMatchObject({ readers: 2, finished: 1, avgPercent: 60, last30: { pageViews: 10, sampleReads: 4 } })
    expect(body.totals.earningsPence).toBe(0)
  })

  it('lets an author reply only on their own book (404 otherwise)', async () => {
    mock.ebookReview.findFirst.mockResolvedValue({ id: 3, ebook: { authorId: 99 } } as never)
    const res = await req('PUT', '/api/my-books/reviews/3/reply', { auth: true, payload: { reply: 'Thanks!' } })
    expect(res.statusCode).toBe(404)
    expect(mock.ebookReview.update).not.toHaveBeenCalled()

    mock.ebookReview.findFirst.mockResolvedValue({ id: 3, ebook: { authorId: 1 } } as never)
    expect((await req('PUT', '/api/my-books/reviews/3/reply', { auth: true, payload: { reply: 'Thanks!' } })).statusCode).toBe(200)
  })
})

describe('helpers', () => {
  it('shows a reviewer as first name + initial', () => {
    expect(reviewerName({ name: 'Priya', surname: 'sharma' })).toBe('Priya S.')
    expect(reviewerName({ name: 'Priya', surname: null })).toBe('Priya')
  })
  it('treats missing or crawler user agents as bots', () => {
    expect(isBot(undefined)).toBe(true)
    expect(isBot('facebookexternalhit/1.1')).toBe(true)
    expect(isBot('Mozilla/5.0 (iPhone) Safari')).toBe(false)
  })
})
