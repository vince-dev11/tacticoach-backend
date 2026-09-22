// Writing a book, as a coach — and the review that stands between writing one
// and it appearing in the shop.
//
// Two things are being defended here, and only one of them is about features.
//
//   1. OWNERSHIP. Until today one person held the owner role, so `adminList`
//      and `adminGet` ran with no author filter and nothing was exposed. The
//      moment a second author exists, a missing `where` is a data breach, not
//      a bug. So these tests assert on the QUERY, not only on the status code:
//      a route that returned 404 for the right reason and a route that
//      returned 404 because the fixture happened to be empty look identical
//      from the outside.
//   2. WHO PUBLISHES. A coach submits; an owner approves. Every path that
//      could let an author set `published` on their own book is tested, since
//      these books can mention children and "how did that get published?" is
//      not a question with a good answer.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import type { Entitlements } from '../src/lib/entitlements.js'
import { transition } from '../src/modules/ebooks/ebook-review.js'

const getEntitlements = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/entitlements.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/entitlements.js')>()),
  getEntitlements,
}))

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

/** A coach on `slug`, holding an active subscription. */
const on = (slug: string): Entitlements => ({
  editorAccess: true,
  playerAccess: false,
  plan: { id: 1, name: slug, slug },
  viaClub: false,
  viaCollaboration: false,
  isClubOwner: false,
  subscriptionStatus: 'active',
  expiresAt: null,
})

function callerIs(accountType: 'coach' | 'player' = 'coach', role = 'user') {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const select = (args as { select?: Record<string, unknown> } | undefined)?.select
    const keys = select ? Object.keys(select) : []
    if (keys.length > 0 && keys.every((k) => k === 'role' || k === 'accountType')) {
      return Promise.resolve({ role, accountType } as never)
    }
    return Promise.resolve({ id: 1, role, accountType } as never)
  })
}

const COVER = { template: 'ball', bg: '#0b3d2e', art: '#ffffff', font: 'sans', weight: '900', style: 'normal', size: '1.55' }
const DETAILS = { title: 'Pressing for U12s', category: 'tactics', ageBand: 'u12_14', cover: COVER }

/** A row as `adminGet` returns it. */
const bookRow = (over: Record<string, unknown> = {}) => ({
  id: 5, authorId: 1, title: 'Pressing for U12s', subtitle: null, slug: 'pressing-for-u12s',
  blurb: null, category: 'tactics', ageBand: 'u12_14', cover: COVER, status: 'draft',
  pricePence: 0, language: 'en', publishedAt: null, submittedAt: null, reviewNote: null,
  author: { name: 'Test', surname: 'Coach', clubLogoKey: null }, chapters: [], ...over,
})

/**
 * A book owned by `authorId`, fetched the way Prisma would fetch it: the
 * author filter in the `where` is APPLIED, so a query that forgot it gets the
 * row back and the test fails. A fixture that simply resolves null proves only
 * that the route handles null.
 */
function belongsTo(authorId: number, over: Record<string, unknown> = {}) {
  mock.ebook.findFirst.mockImplementation(async (args?: unknown) => {
    const where = (args as { where?: Record<string, unknown> } | undefined)?.where ?? {}
    // The slug-uniqueness probe selects { id } only; it is not this query.
    const select = (args as { select?: Record<string, unknown> } | undefined)?.select ?? {}
    if (Object.keys(select).length === 1 && select.id) return null
    if (where.authorId !== undefined && where.authorId !== authorId) return null
    return bookRow({ authorId, ...over }) as never
  })
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const app = await getApp()
  return app.inject({ method, url, headers: authHeaders(await accessToken()), payload: payload as never })
}

beforeEach(() => {
  vi.clearAllMocks()
  callerIs('coach')
  getEntitlements.mockResolvedValue(on('pro'))
  mock.ebook.count.mockResolvedValue(0)
  mock.ebook.findMany.mockResolvedValue([] as never)
  mock.ebookChapter.findMany.mockResolvedValue([{ id: 1, _count: { blocks: 3 } }] as never)
  mock.ebook.findFirst.mockResolvedValue(bookRow() as never)
  mock.ebook.create.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: 5, ...a.data }))
  mock.ebook.update.mockImplementation(async (a: { data: Record<string, unknown> }) => bookRow(a.data))
  mock.ebook.delete.mockResolvedValue(bookRow() as never)
  mock.user.findMany?.mockResolvedValue?.([] as never)
})

// ---------------------------------------------------------------------------
// The state machine, on its own. Two callers depend on it agreeing with
// itself; a rule that holds in the route and not in the function is the kind
// of bug that only shows up in the shop.
// ---------------------------------------------------------------------------

describe('the review state machine', () => {
  const base = { firstPublishAt: null, canPublish: true, hasContent: true, isOwner: false }

  it('will not let an author publish their own book', () => {
    const move = transition({ ...base, from: 'in_review', to: 'published' })
    expect(move.ok).toBe(false)
    // The sentence has to tell them what to do instead, not just say no.
    expect(move.reason).toMatch(/submit it for review/i)
  })

  it('will not let an author reject one either', () => {
    expect(transition({ ...base, from: 'in_review', to: 'rejected', note: 'no' }).ok).toBe(false)
  })

  it('refuses a rejection with no reason — silence makes the coach resubmit the same book', () => {
    const move = transition({ ...base, isOwner: true, from: 'in_review', to: 'rejected' })
    expect(move.ok).toBe(false)
    expect(transition({ ...base, isOwner: true, from: 'in_review', to: 'rejected', note: '   ' }).ok).toBe(false)
    expect(transition({ ...base, isOwner: true, from: 'in_review', to: 'rejected', note: 'Blurry diagrams' }).ok).toBe(true)
  })

  it('stamps publishedAt on the FIRST approval and never moves it', () => {
    const first = transition({ ...base, isOwner: true, from: 'in_review', to: 'published' })
    expect(first.patch!.publishedAt).toBeInstanceOf(Date)

    // Rejected, fixed, approved again three months later: the book is not new.
    const june = new Date('2026-06-01T00:00:00Z')
    const again = transition({ ...base, isOwner: true, from: 'in_review', to: 'published', firstPublishAt: june })
    expect(again.patch!.publishedAt).toBe(june)
  })

  it('refuses to submit an empty book', () => {
    const move = transition({ ...base, from: 'draft', to: 'in_review', hasContent: false })
    expect(move.ok).toBe(false)
    expect(move.reason).toMatch(/at least one chapter/i)
  })

  it('refuses to submit when the plan does not include publishing', () => {
    const move = transition({ ...base, from: 'draft', to: 'in_review', canPublish: false })
    expect(move.ok).toBe(false)
    expect(move.reason).toMatch(/upgrade/i)
  })

  it('lets an author withdraw from review, but not unpublish from the shop', () => {
    expect(transition({ ...base, from: 'in_review', to: 'draft' }).ok).toBe(true)
    // Someone may be halfway through it.
    expect(transition({ ...base, from: 'published', to: 'draft' }).ok).toBe(false)
    expect(transition({ ...base, isOwner: true, from: 'published', to: 'draft' }).ok).toBe(true)
  })

  it('clears the rejection note once the book moves on', () => {
    // Otherwise a published book carries "blurry diagrams" forever, and the
    // author sees it every time they open it.
    expect(transition({ ...base, from: 'rejected', to: 'draft' }).patch!.reviewNote).toBeNull()
    expect(transition({ ...base, from: 'rejected', to: 'in_review' }).patch!.reviewNote).toBeNull()
    expect(transition({ ...base, isOwner: true, from: 'in_review', to: 'published' }).patch!.reviewNote).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Ownership. Asserted on the query, because a 404 proves nothing on its own.
// ---------------------------------------------------------------------------

describe('one coach cannot reach another coach\'s book', () => {
  it('scopes the list to the caller', async () => {
    const res = await call('GET', '/api/my-books')
    expect(res.statusCode).toBe(200)
    expect(mock.ebook.findMany.mock.calls[0][0]!.where).toMatchObject({ authorId: 1 })
  })

  it('scopes the read to the caller', async () => {
    await call('GET', '/api/my-books/5')
    expect(mock.ebook.findFirst.mock.calls[0][0]!.where).toMatchObject({ id: 5, authorId: 1 })
  })

  it('answers 404, not 403, for a book that is not theirs', async () => {
    // 403 would confirm the id is real. "Not a thing that exists for you" is
    // both truer and safer.
    //
    // The fixture HONOURS the filter rather than being handed null, so this
    // fails if the `where` clause is ever dropped — a `mockResolvedValue(null)`
    // would pass against a query that fetched the book regardless of author,
    // which is the exact bug being defended against.
    belongsTo(2)
    for (const [method, url] of [['GET', '/api/my-books/5'], ['PATCH', '/api/my-books/5'], ['DELETE', '/api/my-books/5']] as const) {
      const res = await call(method, url, method === 'PATCH' ? { blurb: 'hi' } : undefined)
      expect(res.statusCode, `${method} ${url}`).toBe(404)
    }
  })

  it('does not write to a book it could not read', async () => {
    belongsTo(2)
    await call('PATCH', '/api/my-books/5', { title: 'Mine now' })
    expect(mock.ebook.update).not.toHaveBeenCalled()
    await call('DELETE', '/api/my-books/5')
    expect(mock.ebook.delete).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

describe('what the plan allows', () => {
  it('refuses a player account outright', async () => {
    // Not 402: there is no plan a player buys to become an author.
    callerIs('player')
    const res = await call('GET', '/api/my-books')
    expect(res.statusCode).toBe(403)
  })

  it('lets a free coach start their first book', async () => {
    getEntitlements.mockResolvedValue(on('free'))
    mock.ebook.count.mockResolvedValue(0)
    const res = await call('POST', '/api/my-books', DETAILS)
    expect(res.statusCode).toBe(201)
  })

  it('refuses the second with a 402 carrying the sentence the UI shows', async () => {
    getEntitlements.mockResolvedValue(on('free'))
    mock.ebook.count.mockResolvedValue(1)
    const res = await call('POST', '/api/my-books', DETAILS)
    expect(res.statusCode).toBe(402)
    expect(res.json().message).toMatch(/one book/i)
    // Refused before the row is written: the refusal costs a click, not a
    // half-created book the coach then has to find and delete.
    expect(mock.ebook.create).not.toHaveBeenCalled()
  })

  it('counts only the caller\'s own books against the limit', async () => {
    getEntitlements.mockResolvedValue(on('free'))
    await call('POST', '/api/my-books', DETAILS)
    expect(mock.ebook.count.mock.calls[0][0]!.where).toMatchObject({ authorId: 1 })
  })

  it('creates a draft, whatever the request asked for', async () => {
    const res = await call('POST', '/api/my-books', { ...DETAILS, status: 'published', publishedAt: new Date().toISOString() })
    expect(res.statusCode).toBe(201)
    const data = mock.ebook.create.mock.calls[0][0]!.data
    expect(data.status).toBe('draft')
    expect(data.publishedAt).toBeNull()
    expect(data.authorId).toBe(1)
  })

  it('answers 402 when it is the PLAN that blocks submitting', async () => {
    // Free can write a book and cannot publish it — that was the whole point
    // of giving free a book at all. 402 so the wall shows a price.
    getEntitlements.mockResolvedValue(on('free'))
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'draft' }) as never)
    const res = await call('PATCH', '/api/my-books/5', { status: 'in_review' })
    expect(res.statusCode).toBe(402)
    expect(res.json().message).toMatch(/upgrade/i)
  })

  it('answers 422 when it is the BOOK that is not ready', async () => {
    // Not 402: no amount of money makes an empty book publishable, and an
    // upgrade prompt here would be a lie.
    mock.ebookChapter.findMany.mockResolvedValue([] as never)
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'draft' }) as never)
    const res = await call('PATCH', '/api/my-books/5', { status: 'in_review' })
    expect(res.statusCode).toBe(422)
  })

  it('refuses an author asking for published directly', async () => {
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'in_review' }) as never)
    const res = await call('PATCH', '/api/my-books/5', { status: 'published' })
    // Rejected by the schema before the state machine even sees it: the set of
    // statuses an author may name does not contain it. (422 is this app's
    // validation code — see the error handler.)
    expect(res.statusCode).toBe(422)
    expect(mock.ebook.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Frozen while reviewed, frozen while sold
// ---------------------------------------------------------------------------

describe('a book under review does not change under the reviewer', () => {
  it('refuses detail edits while in review', async () => {
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'in_review' }) as never)
    const res = await call('PATCH', '/api/my-books/5', { title: 'Something else' })
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toMatch(/withdraw/i)
  })

  it('refuses chapter edits while in review', async () => {
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'in_review' }) as never)
    const res = await call('PUT', '/api/my-books/5/chapters', { chapters: [] })
    expect(res.statusCode).toBe(409)
  })

  it('does not rewrite fields the request never mentioned', async () => {
    // `.partial()` leaves schema defaults in place, so a PATCH that touches
    // only the blurb parsed as { blurb, language: 'en', pricePence: 0 } and
    // re-languaged a Spanish book. The fix is sent-only.ts; this is the test
    // that fails without it.
    await call('PATCH', '/api/my-books/5', { blurb: 'Nine sessions on pressing traps.' })
    expect(Object.keys(mock.ebook.update.mock.calls[0][0]!.data)).toEqual(['blurb'])
  })

  it('still lets them withdraw it — the only move that is not an edit', async () => {
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'in_review' }) as never)
    const res = await call('PATCH', '/api/my-books/5', { status: 'draft' })
    expect(res.statusCode).toBe(200)
  })

  it('refuses edits to a published book', async () => {
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'published' }) as never)
    expect((await call('PATCH', '/api/my-books/5', { blurb: 'new' })).statusCode).toBe(409)
    expect((await call('PUT', '/api/my-books/5/chapters', { chapters: [] })).statusCode).toBe(409)
  })

  it('refuses to delete a book that is in the shop', async () => {
    // It has readers, possibly mid-chapter with notes. Taking it away is a
    // decision with someone else in it.
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'published' }) as never)
    const res = await call('DELETE', '/api/my-books/5')
    expect(res.statusCode).toBe(409)
    expect(mock.ebook.delete).not.toHaveBeenCalled()
  })

  it('deletes a draft', async () => {
    const res = await call('DELETE', '/api/my-books/5')
    expect(res.statusCode).toBe(204)
    expect(mock.ebook.delete).toHaveBeenCalledWith({ where: { id: 5 } })
  })
})

// ---------------------------------------------------------------------------
// The owner's side of the same feature
// ---------------------------------------------------------------------------

describe('the review queue', () => {
  const asOwner = () => callerIs('coach', 'owner')

  it('is closed to a coach', async () => {
    const res = await call('GET', '/api/admin/ebooks/review')
    expect(res.statusCode).toBe(403)
  })

  it('shows what is waiting, oldest first', async () => {
    asOwner()
    await call('GET', '/api/admin/ebooks/review')
    const args = mock.ebook.findMany.mock.calls[0][0]!
    expect(args.where).toMatchObject({ status: 'in_review' })
    // Whoever has waited longest is served first. `updatedAt: desc` — the
    // ordering every other list uses — would put the newest submission on top
    // and quietly starve the oldest.
    expect(args.orderBy).toEqual({ submittedAt: 'asc' })
  })

  it('does not collide with /admin/ebooks/:id', async () => {
    // Fastify matches the static segment first; if it ever stopped, this route
    // would become `adminGet(NaN)` and 404 forever.
    asOwner()
    const res = await call('GET', '/api/admin/ebooks/review')
    expect(res.statusCode).toBe(200)
    expect(mock.ebook.findMany).toHaveBeenCalled()
    expect(mock.ebook.findFirst).not.toHaveBeenCalled()
  })

  it('approves: stamps the date and clears the last rejection note', async () => {
    asOwner()
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'in_review', reviewNote: 'Blurry diagrams' }) as never)
    const res = await call('PATCH', '/api/admin/ebooks/5/review', { status: 'published' })
    expect(res.statusCode).toBe(200)
    const data = mock.ebook.update.mock.calls[0][0]!.data
    expect(data.status).toBe('published')
    expect(data.publishedAt).toBeInstanceOf(Date)
    expect(data.reviewNote).toBeNull()
  })

  it('refuses a rejection with no reason', async () => {
    asOwner()
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'in_review' }) as never)
    const res = await call('PATCH', '/api/admin/ebooks/5/review', { status: 'rejected' })
    expect(res.statusCode).toBe(422)
    expect(mock.ebook.update).not.toHaveBeenCalled()
  })

  it('sends it back with the reason the author will read', async () => {
    asOwner()
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'in_review' }) as never)
    const res = await call('PATCH', '/api/admin/ebooks/5/review', {
      status: 'rejected', note: 'Two diagrams show 12 players on the pitch.',
    })
    expect(res.statusCode).toBe(200)
    expect(mock.ebook.update.mock.calls[0][0]!.data).toMatchObject({
      status: 'rejected', reviewNote: 'Two diagrams show 12 players on the pitch.',
    })
  })

  it('keeps the original publish date when an edited book is re-approved', async () => {
    asOwner()
    const january = new Date('2026-01-05T00:00:00Z')
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'in_review', publishedAt: january }) as never)
    await call('PATCH', '/api/admin/ebooks/5/review', { status: 'published' })
    // Re-approving an edit must not make the book look new in the shop.
    expect(mock.ebook.update.mock.calls[0][0]!.data.publishedAt).toBe(january)
  })

  it('unpublishes — the move no author may make for themselves', async () => {
    asOwner()
    mock.ebook.findFirst.mockResolvedValue(bookRow({ status: 'published', publishedAt: new Date() }) as never)
    const res = await call('PATCH', '/api/admin/ebooks/5/review', { status: 'draft' })
    expect(res.statusCode).toBe(200)
    expect(mock.ebook.update.mock.calls[0][0]!.data.status).toBe('draft')
  })
})

describe('the owner\'s own book edits', () => {
  it('does not pull a published book back to draft on an unrelated edit', async () => {
    // BookInput here carries `status: ...default('draft')`. Before sent-only,
    // a PATCH that changed nothing but the blurb also sent status: 'draft' —
    // silently removing a live book from the shop.
    callerIs('coach', 'owner')
    mock.ebook.findFirst.mockImplementation((args?: unknown) => {
      const select = (args as { select?: Record<string, unknown> })?.select ?? {}
      if (Object.keys(select).length === 1 && select.id) return Promise.resolve(null as never)
      return Promise.resolve(bookRow({ status: 'published', publishedAt: new Date('2026-01-05') }) as never)
    })
    await call('PATCH', '/api/admin/ebooks/5', { blurb: 'A clearer blurb.' })
    expect(Object.keys(mock.ebook.update.mock.calls[0][0]!.data)).toEqual(['blurb'])
  })
})
