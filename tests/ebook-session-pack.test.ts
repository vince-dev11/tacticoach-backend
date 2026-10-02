// SESSION-PACK (2 Oct 2026): a book carries the author's sessions, frozen; a
// reader with access adds editable copies once; copies never fill a session
// allowance; players never get them; a refund takes them back.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { inlineBlocks, setPack, deliverPack, removePackCopies } from '../src/modules/ebooks/session-pack.service.js'
import { refundPurchase } from '../src/modules/ebooks/purchases.service.js'
import { readFileSync } from 'node:fs'

// Club membership has its own tests; here only "outside the club" matters.
vi.mock('../src/modules/ebooks/club-books.js', async (orig) => ({
  ...(await orig<typeof import('../src/modules/ebooks/club-books.js')>()),
  mayOpen: vi.fn(async (b: { clubId: number | null }) => !b.clubId),
}))

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const BOARD = { canvas: { objects: [{ type: 'player' }] }, frames: [] }

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.$transaction.mockImplementation(async (fn: unknown) => (fn as () => Promise<unknown>)() as never)
})

describe('SESSION-PACK · freezing', () => {
  it('inlines the author\'s boards; a sheet keeps its words; text stays', async () => {
    mock.canvasBoard.findMany.mockResolvedValue([{ id: 7, state: BOARD }] as never)
    const out = await inlineBlocks(1, [
      { kind: 'board', refId: 7, title: 'Rondo', minutes: 10 },
      { kind: 'sheet', refId: 9, title: 'Pressing', minutes: 20, organisation: '20 × 20 m' },
      { kind: 'text', title: 'Water', minutes: 2 },
    ])
    expect(out[0]).toEqual({ kind: 'drill', title: 'Rondo', minutes: 10, board: BOARD })
    expect(out[1]).toEqual({ kind: 'drill', title: 'Pressing', minutes: 20, organisation: '20 × 20 m' })
    expect(out[2].kind).toBe('text')
    // Only the author's own boards are read.
    expect((mock.canvasBoard.findMany.mock.calls[0][0] as { where: { userId: number } }).where.userId).toBe(1)
  })
  it('takes only the author\'s own training sessions, never matches', async () => {
    mock.trainingSession.findMany.mockResolvedValue([] as never)
    await expect(setPack(5, 1, [11])).rejects.toThrow(/own training sessions/)
    const where = (mock.trainingSession.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where).toMatchObject({ userId: 1, isMatch: false })
  })
  it('replaces the pack with snapshots, in order, without dates or squads', async () => {
    mock.trainingSession.findMany.mockResolvedValue([
      { id: 12, title: 'B', blocks: [], targetMinutes: 60, sessionType: 'tactical', squadId: 3, sessionDate: new Date() },
      { id: 11, title: 'A', blocks: [], targetMinutes: 75 },
    ] as never)
    mock.ebookSessionPack.findMany.mockResolvedValue([] as never)
    await setPack(5, 1, [11, 12])
    expect(mock.ebookSessionPack.deleteMany).toHaveBeenCalledWith({ where: { ebookId: 5 } })
    const rows = (mock.ebookSessionPack.createMany.mock.calls[0][0] as { data: { title: string; sortOrder: number; snapshot: Record<string, unknown> }[] }).data
    expect(rows.map((r) => [r.title, r.sortOrder])).toEqual([['A', 0], ['B', 1]])
    expect(rows[1].snapshot).not.toHaveProperty('squadId')
    expect(rows[1].snapshot).not.toHaveProperty('sessionDate')
  })
})

describe('SESSION-PACK · delivering', () => {
  it('adds copies marked with the book, once', async () => {
    mock.trainingSession.count.mockResolvedValue(0 as never)
    mock.ebookSessionPack.findMany.mockResolvedValue([{ id: 1, title: 'A', snapshot: { blocks: [{ kind: 'text' }], targetMinutes: 60 }, sortOrder: 0 }] as never)
    mock.trainingSession.create.mockResolvedValue({ id: 99 } as never)
    expect(await deliverPack(5, 2)).toEqual({ added: 1, already: false })
    const data = (mock.trainingSession.create.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data).toMatchObject({ userId: 2, sourceEbookId: 5, title: 'A', targetMinutes: 60 })
    mock.trainingSession.count.mockResolvedValue(1 as never)
    expect(await deliverPack(5, 2)).toEqual({ added: 0, already: true })
  })
  it('copies never count against a session allowance', () => {
    expect(readFileSync('src/lib/plan-quota.ts', 'utf8')).toMatch(/sessions: \(userId\) => db\.trainingSession\.count\(\{ where: \{ userId, isMatch: false, sourceEbookId: null \}/)
    // and are created without reserving a free-trial slot
    expect(readFileSync('src/modules/ebooks/session-pack.service.ts', 'utf8')).not.toMatch(/withQuota\(|reserveFreeSlot\(/)
  })
  it('a refund removes the copies', async () => {
    mock.ebookPurchase.findUnique.mockResolvedValue({ id: 3, status: 'paid', ebookId: 5, userId: 2 } as never)
    mock.ebookPurchase.update.mockResolvedValue({ id: 3, status: 'refunded' } as never)
    mock.trainingSession.deleteMany.mockResolvedValue({ count: 4 } as never)
    await refundPurchase(3)
    expect(mock.trainingSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 2, sourceEbookId: 5 } })
    expect(await removePackCopies(5, 2)).toBe(4)
  })
})

describe('SESSION-PACK · POST /api/ebooks/:slug/pack', () => {
  const post = async () => {
    const app = await getApp()
    return app.inject({ method: 'POST', url: '/api/ebooks/pressing/pack', headers: authHeaders(await accessToken()) })
  }
  it('refuses a player', async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: 1, role: 'user', accountType: 'player' } as never)
    const res = await post()
    expect(res.statusCode).toBe(403)
    expect(mock.trainingSession.create).not.toHaveBeenCalled()
  })
  it('refuses a coach who has not got the book', async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: 1, role: 'user', accountType: 'coach' } as never)
    mock.ebook.findFirst.mockResolvedValue({ id: 5, authorId: 9, pricePence: 999 } as never)
    mock.ebookPurchase.findFirst.mockResolvedValue(null as never)
    mock.ebookCoauthor.findFirst.mockResolvedValue(null as never)
    const res = await post()
    expect(res.statusCode).toBe(403)
    expect(mock.trainingSession.create).not.toHaveBeenCalled()
  })
  it('a club book outside your club does not exist', async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: 1, role: 'user', accountType: 'coach' } as never)
    mock.ebook.findFirst.mockResolvedValue({ id: 5, authorId: 9, pricePence: 0, clubId: 77, clubAudience: 'coaches' } as never)
    const res = await post()
    expect(res.statusCode).toBe(404)
    expect(mock.trainingSession.create).not.toHaveBeenCalled()
  })
  it('adds the sessions for a free book', async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: 1, role: 'user', accountType: 'coach' } as never)
    mock.ebook.findFirst.mockResolvedValue({ id: 5, authorId: 9, pricePence: 0 } as never)
    mock.trainingSession.count.mockResolvedValue(0 as never)
    mock.ebookSessionPack.findMany.mockResolvedValue([{ id: 1, title: 'A', snapshot: { blocks: [] }, sortOrder: 0 }] as never)
    mock.trainingSession.create.mockResolvedValue({ id: 99 } as never)
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ added: 1, already: false })
  })
})
