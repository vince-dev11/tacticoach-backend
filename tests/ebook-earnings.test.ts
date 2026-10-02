// EARNINGS (2 Oct 2026): what an author has sold, refunded and is owed.
// Real sales only — grants and the owner's test purchases are not money.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { authorEarnings } from '../src/modules/ebooks/purchases.service.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>

beforeEach(() => { vi.clearAllMocks() })

describe('EARNINGS · authorEarnings', () => {
  it('asks only for real checkout sales of the author\'s own books', async () => {
    mock.ebookPurchase.findMany.mockResolvedValue([] as never)
    await authorEarnings([5, 6])
    const where = (mock.ebookPurchase.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where.ebookId).toEqual({ in: [5, 6] })
    expect(where.source).toBe('checkout')
    expect(where.provider).toEqual({ notIn: ['test'] })
    expect(where.NOT).toEqual({ provider: null })
    expect(where.status).toEqual({ in: ['paid', 'refunded'] })
  })
  it('sums the stored author share; refunds count but earn nothing', async () => {
    mock.ebookPurchase.findMany.mockResolvedValue([
      { ebookId: 5, status: 'paid', pricePence: 999, authorSharePence: 699 },
      { ebookId: 5, status: 'paid', pricePence: 999, authorSharePence: 699 },
      { ebookId: 6, status: 'refunded', pricePence: 1499, authorSharePence: 1049 },
    ] as never)
    const e = await authorEarnings([5, 6])
    expect(e).toMatchObject({ sales: 3, refunds: 1, grossPence: 1998, refundedPence: 1499, authorSidePence: 1398, owedPence: 1398 })
    expect(e.perBook.get(5)).toEqual({ sales: 2, refunds: 0, authorSidePence: 1398 })
    expect(e.perBook.get(6)).toEqual({ sales: 1, refunds: 1, authorSidePence: 0 })
  })
  it('no books, no query', async () => {
    const e = await authorEarnings([])
    expect(mock.ebookPurchase.findMany).not.toHaveBeenCalled()
    expect(e.owedPence).toBe(0)
  })
  it('never selects who bought', async () => {
    mock.ebookPurchase.findMany.mockResolvedValue([] as never)
    await authorEarnings([5])
    const select = (mock.ebookPurchase.findMany.mock.calls[0][0] as { select: Record<string, unknown> }).select
    expect(Object.keys(select)).not.toContain('userId')
    expect(Object.keys(select)).not.toContain('user')
  })
})
