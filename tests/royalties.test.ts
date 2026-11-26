// ROYALTIES (25 Nov 2026) · TactiCoach is paid 100% of each book sale and pays
// authors their 70% from its bank every month. The ledger must never pay out
// money that can still be refunded, never let a payout exceed what is owed,
// and carry a late refund into the next payout.
import { describe, it, expect, beforeEach } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { balances, monthCsv, payeeShares, recordPayout, ROYALTY_HOLD_DAYS } from '../src/modules/ebooks/royalties.service.js'

const NOW = new Date('2026-11-25T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
const book = (coauthors: Array<{ userId: number; sharePercent: number; acceptedAt: Date | null }> = []) =>
  ({ id: 2, title: 'Pressing for U12s', authorId: 10, coauthors })

beforeEach(() => {
  dbMock.authorPayout.findMany.mockResolvedValue([])
})

describe('ROYALTIES · the author side is shared', () => {
  it('co-authors get their share of the 70%; the lead author the rest (and the rounding)', () => {
    const s = payeeShares(349, 10, [{ userId: 11, sharePercent: 30, acceptedAt: daysAgo(40) }])
    expect(s.get(11)).toBe(104)
    expect(s.get(10)).toBe(245)
    expect([...s.values()].reduce((a, b) => a + b, 0)).toBe(349)
  })
  it('an invitation not yet accepted shares nothing', () => {
    const s = payeeShares(350, 10, [{ userId: 11, sharePercent: 30, acceptedAt: null }])
    expect(s.get(10)).toBe(350)
    expect(s.has(11)).toBe(false)
  })
})

describe('ROYALTIES · what is owed', () => {
  it(`a sale counts after the ${ROYALTY_HOLD_DAYS}-day refund window; refunded sales never count`, async () => {
    dbMock.ebookPurchase.findMany.mockResolvedValue([
      { id: 1, status: 'paid', paidAt: daysAgo(30), pricePence: 500, authorSharePence: 350, ebook: book() },
      { id: 2, status: 'paid', paidAt: daysAgo(3), pricePence: 500, authorSharePence: 350, ebook: book() },
      { id: 3, status: 'refunded', paidAt: daysAgo(30), pricePence: 500, authorSharePence: 350, ebook: book() },
    ] as never)
    const b = (await balances(undefined, NOW)).get(10)!
    expect(b).toMatchObject({ clearedPence: 350, pendingPence: 350, paidOutPence: 0, owedPence: 350 })
  })

  it('a refund after the payout is taken off the next one (it can go below zero)', async () => {
    dbMock.ebookPurchase.findMany.mockResolvedValue([
      { id: 1, status: 'refunded', paidAt: daysAgo(60), pricePence: 500, authorSharePence: 350, ebook: book() },
    ] as never)
    dbMock.authorPayout.findMany.mockResolvedValue([{ userId: 10, amountPence: 350, paidAt: daysAgo(20) }] as never)
    const b = (await balances(undefined, NOW)).get(10)!
    expect(b.owedPence).toBe(-350)
  })

  it('only real sales are read: checkout through a gateway, never test purchases or gifts', async () => {
    dbMock.ebookPurchase.findMany.mockResolvedValue([])
    await balances(undefined, NOW)
    const where = (dbMock.ebookPurchase.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where).toMatchObject({ source: 'checkout', provider: { notIn: ['test'] }, NOT: { provider: null } })
  })
})

describe('ROYALTIES · recording a payout', () => {
  beforeEach(() => {
    dbMock.ebookPurchase.findMany.mockResolvedValue([
      { id: 1, status: 'paid', paidAt: daysAgo(30), pricePence: 2000, authorSharePence: 1400, ebook: book() },
    ] as never)
  })

  it('needs the payee’s legal name first', async () => {
    dbMock.authorPayee.findUnique.mockResolvedValue(null)
    await expect(recordPayout(1, { userId: 10, amountPence: 1400, reference: 'BANK-1' })).rejects.toMatchObject({ code: 'no_payee' })
  })

  it('never more than is owed', async () => {
    dbMock.authorPayee.findUnique.mockResolvedValue({ userId: 10, legalName: 'Sam Coach' } as never)
    await expect(recordPayout(1, { userId: 10, amountPence: 1401, reference: 'BANK-1' })).rejects.toMatchObject({ code: 'over_owed' })
  })

  it('records the reference and the payee’s name (kept if the account is deleted)', async () => {
    dbMock.authorPayee.findUnique.mockResolvedValue({ userId: 10, legalName: 'Sam Coach' } as never)
    dbMock.authorPayout.create.mockResolvedValue({ id: 1 } as never)
    await recordPayout(1, { userId: 10, amountPence: 1400, reference: ' BANK-1 ' })
    expect(dbMock.authorPayout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 10, payeeName: 'Sam Coach', amountPence: 1400, reference: 'BANK-1', currency: 'GBP', createdById: 1 }),
    })
  })
})

describe('ROYALTIES · CSV for the accountant', () => {
  it('a value starting with = never runs as a formula', async () => {
    dbMock.ebookPurchase.findMany.mockResolvedValue([
      { id: 1, status: 'paid', paidAt: new Date('2026-11-03T10:00:00Z'), pricePence: 500, authorSharePence: 350, ebook: { ...book(), title: '=HYPERLINK("x")' } },
    ] as never)
    dbMock.user.findMany.mockResolvedValue([{ id: 10, name: 'Sam', surname: 'Coach', email: 's@test.dev' }] as never)
    const csv = await monthCsv('2026-11')
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv.split('\n')[1]).toMatch(/^sale,2026-11-03,1,/)
  })
})

describe('ROYALTIES · Admin routes are the owner’s only', () => {
  it('a normal account is refused', async () => {
    dbMock.user.findUnique.mockResolvedValue({ role: 'user' } as never)
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/author-payouts', headers: authHeaders(await accessToken(5)) })
    expect(res.statusCode).toBe(403)
  })
  it('the owner sees the roster', async () => {
    dbMock.user.findUnique.mockResolvedValue({ role: 'owner' } as never)
    dbMock.ebookPurchase.findMany.mockResolvedValue([])
    const app = await getApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/author-payouts', headers: authHeaders(await accessToken(1)) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ holdDays: 14, minPayoutPence: 1000, payees: [] })
  })
})
