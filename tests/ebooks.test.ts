// Ebooks — the shop, and reading one.
//
// The rule worth breaking a build over: NOTHING returns a whole book. If an
// endpoint ever hands back every chapter's text at once, "the book cannot be
// downloaded" stops being a property of the software and becomes a sentence in
// the marketing.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { playerMayCall } from '../src/lib/player-lockdown.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

function callerIs(accountType: 'coach' | 'player', role = 'user') {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const select = (args as { select?: Record<string, unknown> } | undefined)?.select
    const keys = select ? Object.keys(select) : []
    if (keys.length > 0 && keys.every((k) => k === 'role' || k === 'accountType')) {
      return Promise.resolve({ role, accountType } as never)
    }
    return Promise.resolve({ id: 1, role, accountType } as never)
  })
}

const get = async (url: string) => {
  const app = await getApp()
  return app.inject({ method: 'GET', url, headers: authHeaders(await accessToken()) })
}

const COVER = { template: 'ball', bg: '#0b3d2e', art: '#ffffff', font: 'sans', weight: '900', style: 'normal', size: '1.55' }

beforeEach(() => {
  vi.clearAllMocks()
  callerIs('coach')
})

describe('the shop', () => {
  it('asks for published books and nothing else', async () => {
    // A draft is the author's private workspace. A bug that listed one would
    // publish something nobody meant to publish.
    mock.ebook.findMany.mockResolvedValue([] as never)
    await get('/api/ebooks')
    expect(mock.ebook.findMany.mock.calls[0][0]!.where.status).toBe('published')
  })

  it('includes "all ages" books under every age filter', async () => {
    // A book marked as suiting every age must appear when somebody filters to
    // U12–14, not only under its own label.
    mock.ebook.findMany.mockResolvedValue([] as never)
    await get('/api/ebooks?age=u12_14')
    expect(mock.ebook.findMany.mock.calls[0][0]!.where.ageBand).toEqual({ in: ['u12_14', 'all'] })
  })

  it('ignores a category that is not one of ours', async () => {
    mock.ebook.findMany.mockResolvedValue([] as never)
    await get('/api/ebooks?category=nonsense')
    expect(mock.ebook.findMany.mock.calls[0][0]!.where.category).toBeUndefined()
  })

  it('returns covers and counts, never chapter content', async () => {
    mock.ebook.findMany.mockResolvedValue([{
      id: 1, slug: 'playing-out', title: 'Playing Out From The Back', subtitle: null,
      category: 'tactics', ageBand: 'u12_14', cover: COVER, pricePence: 0,
      author: { name: 'Marco', surname: 'Rossi', clubName: 'Riverside' },
      _count: { chapters: 7 },
    }] as never)

    const body = (await get('/api/ebooks')).json()
    expect(body[0].chapters).toBe(7)
    expect(body[0].author).toBe('Marco Rossi')
    expect(body[0].cover.template).toBe('ball')
    expect(JSON.stringify(body)).not.toContain('blocks')
  })

  it('does not decorate anything as a best seller before sales exist', async () => {
    // Honestly false for everything rather than randomly sprinkled. When sales
    // land it becomes top 10% by copies in 30 days, computed — never set by
    // an author.
    mock.ebook.findMany.mockResolvedValue([{
      id: 1, slug: 's', title: 'T', subtitle: null, category: 'tactics', ageBand: 'all',
      cover: COVER, pricePence: 0, author: { name: 'A', surname: null, clubName: null },
      _count: { chapters: 1 },
    }] as never)
    expect((await get('/api/ebooks')).json()[0].bestSeller).toBe(false)
  })
})

describe('the book page', () => {
  it('returns chapter TITLES only — no blocks cross this boundary', async () => {
    mock.ebook.findFirst.mockResolvedValue({
      id: 1, slug: 'playing-out', title: 'Playing Out', subtitle: null, blurb: 'A book.',
      category: 'tactics', ageBand: 'u12_14', cover: COVER, pricePence: 0, language: 'en',
      author: { name: 'Marco', surname: 'Rossi', clubName: 'Riverside' },
      chapters: [{ id: 5, title: 'Angles', sortOrder: 0, isSample: true }],
    } as never)
    mock.ebookProgress.findUnique.mockResolvedValue(null as never)

    const body = (await get('/api/ebooks/playing-out')).json()
    expect(body.chapters).toHaveLength(1)
    expect(body.chapters[0].title).toBe('Angles')
    expect(body.chapters[0]).not.toHaveProperty('blocks')

    // The select must not ask for blocks at all — a test on the response
    // alone would pass even if they were fetched and dropped.
    const select = mock.ebook.findFirst.mock.calls[0][0]!.select
    expect(select.chapters.select).not.toHaveProperty('blocks')
  })

  it('404s an unpublished book rather than revealing it exists', async () => {
    mock.ebook.findFirst.mockResolvedValue(null as never)
    expect((await get('/api/ebooks/secret-draft')).statusCode).toBe(404)
  })
})

describe('reading a chapter', () => {
  const chapter = (over: Record<string, unknown> = {}) => ({
    id: 5, ebookId: 1, title: 'Angles', sortOrder: 1, isSample: false,
    blocks: [{ id: 9, kind: 'text', sortOrder: 0, data: { text: 'Here is the thing.' } }],
    ...over,
  })

  it('returns one chapter, by id', async () => {
    mock.ebookChapter.findFirst.mockResolvedValue(chapter() as never)
    mock.ebook.findFirst.mockResolvedValue({ pricePence: 0, title: 'T', slug: 's' } as never)

    const body = (await get('/api/ebooks/playing-out/c/5')).json()
    expect(body.locked).toBe(false)
    expect(body.blocks).toHaveLength(1)
    // Scoped to the book in the URL, so a chapter id from another book cannot
    // be read by guessing.
    const where = mock.ebookChapter.findFirst.mock.calls[0][0]!.where
    expect(where.id).toBe(5)
    expect(where.ebook).toEqual({ slug: 'playing-out', status: 'published' })
  })

  it('locks a paid book past the sample, with 402 not 403', async () => {
    // 402 because this is "not yet, and there is something you could do about
    // it" — not "you may never".
    mock.ebookChapter.findFirst.mockResolvedValue(chapter({ isSample: false }) as never)
    mock.ebook.findFirst.mockResolvedValue({ pricePence: 499, title: 'T', slug: 's' } as never)

    const res = await get('/api/ebooks/playing-out/c/5')
    expect(res.statusCode).toBe(402)
    expect(JSON.stringify(res.json())).not.toContain('Here is the thing')
  })

  it('opens the sample chapter of a paid book', async () => {
    mock.ebookChapter.findFirst.mockResolvedValue(chapter({ isSample: true }) as never)
    mock.ebook.findFirst.mockResolvedValue({ pricePence: 499, title: 'T', slug: 's' } as never)
    expect((await get('/api/ebooks/playing-out/c/5')).statusCode).toBe(200)
  })

  it('opens every chapter of a free book', async () => {
    mock.ebookChapter.findFirst.mockResolvedValue(chapter({ isSample: false }) as never)
    mock.ebook.findFirst.mockResolvedValue({ pricePence: 0, title: 'T', slug: 's' } as never)
    expect((await get('/api/ebooks/playing-out/c/5')).statusCode).toBe(200)
  })
})

describe('authoring', () => {
  // The admin screen renders the SAME BookCover component as the shop, so the
  // authoring endpoints must hand it the same shape. Before this, admin
  // returned the raw Prisma row — a nested {name, surname} where the component
  // wanted a line of text — and a book looked right in the shop and broken in
  // the screen used to build it.
  const asOwner = () => callerIs('coach', 'owner')

  it('flattens the author and the chapter count, exactly like the shop', async () => {
    asOwner()
    mock.ebook.findMany.mockResolvedValue([{
      id: 1, slug: 'playing-out', title: 'Playing Out', subtitle: null, status: 'draft',
      category: 'tactics', ageBand: 'u12_14', cover: COVER, pricePence: 0,
      publishedAt: null, updatedAt: new Date(),
      author: { name: 'Marco', surname: 'Rossi' },
      _count: { chapters: 7 },
    }] as never)

    const body = (await get('/api/admin/ebooks')).json()
    expect(body[0].author).toBe('Marco Rossi')
    expect(body[0].chapters).toBe(7)
  })

  it('lists drafts — the authoring list is the one place they must appear', async () => {
    // The mirror of the shop's first test. The shop filters to published; this
    // must NOT, or a draft becomes uneditable the moment it is created.
    asOwner()
    mock.ebook.findMany.mockResolvedValue([] as never)
    await get('/api/admin/ebooks')
    expect(mock.ebook.findMany.mock.calls[0][0]!.where).toBeUndefined()
  })

  it('selects publishedAt, so re-publishing an edit cannot restamp it', async () => {
    // PATCH decides "is this the first publish?" by reading existing.publishedAt.
    // The Prisma shim declares the field on the row type, so omitting it from
    // the select typechecked fine and arrived undefined — every save moved the
    // date and made an edited book look new in the shop.
    asOwner()
    mock.ebook.findFirst.mockResolvedValue({
      id: 1, title: 'T', subtitle: null, slug: 's', blurb: null, category: 'tactics',
      ageBand: 'all', cover: COVER, status: 'draft', pricePence: 0, language: 'en',
      publishedAt: null, author: { name: 'A', surname: null }, chapters: [],
    } as never)
    await get('/api/admin/ebooks/1')
    expect(mock.ebook.findFirst.mock.calls[0][0]!.select).toHaveProperty('publishedAt', true)
  })

  it('keeps the original publish date when a published book is edited', async () => {
    asOwner()
    const published = new Date('2026-01-05T00:00:00Z')
    // Two different findFirst callers on this request: "load the book" and
    // "is this slug free?". Answering both with the book row told uniqueSlug
    // that every candidate was taken, and it spun until the process ran out of
    // memory. Keyed on the select, never on call order.
    mock.ebook.findFirst.mockImplementation((args?: unknown) => {
      const select = (args as { select?: Record<string, unknown> })?.select ?? {}
      if (Object.keys(select).length === 1 && select.id) return Promise.resolve(null as never)
      return Promise.resolve({
        id: 1, title: 'T', subtitle: null, slug: 's', blurb: null, category: 'tactics',
        ageBand: 'all', cover: COVER, status: 'published', pricePence: 0, language: 'en',
        publishedAt: published, author: { name: 'A', surname: null }, chapters: [],
      } as never)
    })
    mock.ebook.update.mockResolvedValue({ id: 1 } as never)

    const app = await getApp()
    await app.inject({
      method: 'PATCH',
      url: '/api/admin/ebooks/1',
      headers: authHeaders(await accessToken()),
      payload: { title: 'A Better Title', status: 'published' },
    })
    expect(mock.ebook.update.mock.calls[0][0]!.data).not.toHaveProperty('publishedAt')
  })

  it('refuses a cover colour that is not a hex value', async () => {
    // The cover is stored as JSON, so validation here is the only thing
    // standing between a colour picker and arbitrary CSS in every reader.
    asOwner()
    const app = await getApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ebooks',
      headers: authHeaders(await accessToken()),
      payload: {
        title: 'T', category: 'tactics', ageBand: 'all',
        cover: { ...COVER, bg: 'url(javascript:alert(1))' },
      },
    })
    // 422 here, not 400 — the app maps Zod failures itself. Asserting the
    // family rather than the digit: what matters is that nothing was written.
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(mock.ebook.create).not.toHaveBeenCalled()
  })

  it('is closed to a coach who is not the owner', async () => {
    callerIs('coach', 'user')
    expect((await get('/api/admin/ebooks')).statusCode).toBe(403)
  })
})

describe('boards drawn inside a chapter', () => {
  const chapterWith = (blocks: { kind: string; data: unknown }[]) => {
    mock.ebookChapter.findFirst.mockResolvedValue({
      id: 5, ebookId: 1, title: 'Angles', sortOrder: 0, isSample: true,
      blocks: blocks.map((b, i) => ({ id: i + 1, kind: b.kind, sortOrder: i, data: b.data })),
    } as never)
    mock.ebook.findFirst.mockResolvedValue({
      pricePence: 0, title: 'T', slug: 'playing-out', authorId: 7,
    } as never)
  }

  it('fetches ONLY boards belonging to the book\'s author', async () => {
    // A block stores a board id, and an id is one digit away from another
    // coach's board. Without the author scope, editing that number in a draft
    // would pull somebody's private work into a published book.
    chapterWith([{ kind: 'board', data: { boardId: 12 } }])
    mock.canvasBoard.findMany.mockResolvedValue([] as never)

    await get('/api/ebooks/playing-out/c/5')

    const where = mock.canvasBoard.findMany.mock.calls[0][0]!.where
    expect(where.id).toEqual({ in: [12] })
    expect(where.userId, 'the board lookup must be scoped to the author').toBe(7)
  })

  it('collects ids from every kind of board block, including both sides of a compare', async () => {
    chapterWith([
      { kind: 'board', data: { boardId: 12 } },
      { kind: 'board_compare', data: { leftId: 20, rightId: 21 } },
      { kind: 'board_sequence', data: { boardId: 30, frames: [0, 1] } },
      { kind: 'drill', data: { boardId: 12 } },
      { kind: 'text', data: { text: 'not a board' } },
    ])
    mock.canvasBoard.findMany.mockResolvedValue([] as never)

    await get('/api/ebooks/playing-out/c/5')

    // 12 appears twice and is asked for once.
    expect(mock.canvasBoard.findMany.mock.calls[0][0]!.where.id).toEqual({ in: [12, 20, 21, 30] })
  })

  it('returns the scenes beside the blocks, keyed by id', async () => {
    chapterWith([{ kind: 'board', data: { boardId: 12 } }])
    mock.canvasBoard.findMany.mockResolvedValue([
      { id: 12, title: 'Playing out 1', state: { canvas: { objects: [] }, frames: [] } },
    ] as never)

    const body = (await get('/api/ebooks/playing-out/c/5')).json()
    expect(body.boards['12'].title).toBe('Playing out 1')
    expect(body.boards['12'].state).toBeTruthy()
  })

  it('asks for nothing when the chapter draws no boards', async () => {
    // A chapter of pure prose must not cost a board query.
    chapterWith([{ kind: 'text', data: { text: 'Words only.' } }])
    await get('/api/ebooks/playing-out/c/5')
    expect(mock.canvasBoard.findMany).not.toHaveBeenCalled()
  })

  it('ignores junk where a board id should be', async () => {
    chapterWith([
      { kind: 'board', data: { boardId: 'twelve' } },
      { kind: 'board', data: { boardId: -3 } },
      { kind: 'board', data: { boardId: 1.5 } },
      { kind: 'board', data: {} },
    ])
    await get('/api/ebooks/playing-out/c/5')
    expect(mock.canvasBoard.findMany).not.toHaveBeenCalled()
  })

  it('sends no board scenes with a LOCKED chapter', async () => {
    // The lock exists to withhold the chapter's content, and on a visual book
    // the boards ARE the content — handing them over with a 402 would give
    // away the thing being paid for.
    mock.ebookChapter.findFirst.mockResolvedValue({
      id: 5, ebookId: 1, title: 'Angles', sortOrder: 2, isSample: false,
      blocks: [{ id: 1, kind: 'board', sortOrder: 0, data: { boardId: 12 } }],
    } as never)
    mock.ebook.findFirst.mockResolvedValue({
      pricePence: 499, title: 'T', slug: 'playing-out', authorId: 7,
    } as never)

    const res = await get('/api/ebooks/playing-out/c/5')
    expect(res.statusCode).toBe(402)
    expect(JSON.stringify(res.json())).not.toContain('boards')
    expect(mock.canvasBoard.findMany).not.toHaveBeenCalled()
  })
})

describe('when the Prisma client predates migration 28', () => {
  it('says what to run instead of a bare Internal Server Error', async () => {
    // The real failure this reproduces: a client generated before the ebooks
    // models makes db.ebook undefined, and the first call dies with "Cannot
    // read properties of undefined". The error handler masks every 500 — right,
    // since driver messages name tables and hosts — so the screen showed
    // "Internal Server Error" and nothing about the two commands that fix it.
    const real = Object.getOwnPropertyDescriptor(dbMock, 'ebook')
    Object.defineProperty(dbMock, 'ebook', { value: undefined, configurable: true })
    try {
      const res = await get('/api/ebooks')
      expect(res.statusCode).toBe(503)
      expect(res.json().message).toMatch(/prisma generate/)
    } finally {
      if (real) Object.defineProperty(dbMock, 'ebook', real)
    }
  })
})

describe('players can actually reach the shop', () => {
  it('is on the lockdown allow-list', () => {
    // Players are the AUDIENCE. A deny-by-default list that forgot ebooks
    // would have shipped a bookshop only coaches could see — and the bug
    // would have looked like an empty shop, not an error.
    expect(playerMayCall('/api/ebooks')).toBe(true)
    expect(playerMayCall('/api/ebooks/playing-out/c/5')).toBe(true)
  })

  it('lets a player read', async () => {
    callerIs('player')
    mock.ebook.findMany.mockResolvedValue([] as never)
    expect((await get('/api/ebooks')).statusCode).toBe(200)
  })

  it('still keeps them out of authoring', () => {
    expect(playerMayCall('/api/admin/ebooks')).toBe(false)
  })
})
