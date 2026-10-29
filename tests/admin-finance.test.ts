// FINANCE (28 Oct 2026, owner): Admin → Finance — Stripe ledger, expenses and
// the profit and loss in INR, cash basis. Owner-only.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { buildPnl, istMonth, monthsBetween, ratesByMonth, type PnlTxn } from '../src/modules/admin/finance/pnl.js'
import { nextDate, occurrences } from '../src/modules/admin/finance/expenses.js'
import { classify } from '../src/modules/admin/finance/stripe-sync.js'

const mock = dbMock as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
let role: 'owner' | 'user' = 'owner'
const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
  const app = await getApp()
  return app.inject({ method, url, headers: authHeaders(await accessToken()), payload: payload as never })
}
beforeEach(() => {
  vi.clearAllMocks()
  role = 'owner'
  dbMock.user.findUnique.mockImplementation((() => Promise.resolve({ id: 1, role, accountType: 'coach' })) as never)
})

const txn = (p: Partial<PnlTxn>): PnlTxn => ({
  kind: 'subscription', refundOf: null, amount: 0, fee: 0, currency: 'inr', chargeAmount: null, chargeCurrency: null,
  paymentIntent: null, occurredAt: new Date('2026-10-10T10:00:00Z'), ...p,
})

describe('FINANCE · profit and loss arithmetic', () => {
  it('revenue − fees − authors − commission − expenses = profit, per month', () => {
    const { months, total } = buildPnl(['2026-10'], {
      txns: [
        txn({ kind: 'subscription', amount: 100_000, fee: 3_000, chargeAmount: 899, chargeCurrency: 'gbp' }),
        txn({ kind: 'book', amount: 50_000, fee: 2_000, paymentIntent: 'pi_b', chargeAmount: 450, chargeCurrency: 'gbp' }),
        txn({ kind: 'refund', refundOf: 'subscription', amount: -20_000 }),
        txn({ kind: 'fee', amount: -1_000 }),
      ],
      bookShare: new Map([['pi_b', 70]]),
      expenses: [{ date: new Date('2026-10-05T00:00:00Z'), category: 'hosting', amountInr: 40_000 }],
      commissions: [{ createdAt: new Date('2026-10-11T00:00:00Z'), commissionAmount: 100, currency: 'GBP', reversedAt: null }],
    })
    const m = months[0]
    expect(m.revenue).toBe(130_000)
    expect(m.stripeFees).toBe(6_000)
    expect(m.authorShare).toBe(35_000)
    // GBP commission at the month's own Stripe rate: 150 000 paise ÷ 1 349 pence.
    expect(m.partnerCommission).toBe(Math.round(100 * (150_000 / 1349)))
    expect(m.expenses).toEqual({ hosting: 40_000 })
    expect(m.profit).toBe(m.revenue - m.stripeFees - m.authorShare - m.partnerCommission - 40_000)
    expect(total.profit).toBe(m.profit)
  })

  it('a refunded book takes the author\'s share back; reversed commission is not a cost', () => {
    const { months } = buildPnl(['2026-10'], {
      txns: [txn({ kind: 'book', amount: 50_000, paymentIntent: 'pi_b' }), txn({ kind: 'refund', refundOf: 'book', amount: -50_000, paymentIntent: 'pi_b' })],
      bookShare: new Map(), expenses: [],
      commissions: [{ createdAt: new Date('2026-10-11T00:00:00Z'), commissionAmount: 100, currency: 'INR', reversedAt: new Date() }],
    })
    expect(months[0].revenue).toBe(0)
    expect(months[0].authorShare).toBe(0)
    expect(months[0].partnerCommission).toBe(0)
  })

  it('months are India time; ranges and rates', () => {
    expect(istMonth(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11')
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(ratesByMonth([txn({ amount: 1100, chargeAmount: 10, chargeCurrency: 'gbp' })]).get('2026-10')).toBe(110)
  })
})

describe('FINANCE · repeating expenses', () => {
  it('monthly keeps the day, clamped to short months; yearly too', () => {
    expect(nextDate(new Date('2026-01-31T00:00:00Z'), 'monthly', 1).toISOString().slice(0, 10)).toBe('2026-02-28')
    expect(nextDate(new Date('2026-01-31T00:00:00Z'), 'monthly', 2).toISOString().slice(0, 10)).toBe('2026-03-31')
    expect(nextDate(new Date('2024-02-29T00:00:00Z'), 'yearly', 1).toISOString().slice(0, 10)).toBe('2025-02-28')
    expect(occurrences(new Date('2026-08-15T00:00:00Z'), 'monthly', new Date('2026-10-28T00:00:00Z')).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-09-15', '2026-10-15'])
  })
})

describe('FINANCE · what a Stripe balance transaction is', () => {
  const noBook = async () => false
  it('payouts are not income; fees are costs; a book charge is a book', async () => {
    expect(await classify({ type: 'payout' } as never, noBook)).toBeNull()
    expect((await classify({ type: 'stripe_fee' } as never, noBook))!.kind).toBe('fee')
    const book = await classify({ type: 'charge', source: { amount: 450, currency: 'gbp', payment_intent: 'pi_1', metadata: { kind: 'book' }, customer: 'cus_1' } } as never, noBook)
    expect(book).toMatchObject({ kind: 'book', chargeAmount: 450, chargeCurrency: 'gbp', paymentIntent: 'pi_1', customer: 'cus_1' })
    const sub = await classify({ type: 'charge', source: { amount: 899, currency: 'gbp', payment_intent: 'pi_2', metadata: {}, customer: 'cus_2' } } as never, noBook)
    expect(sub!.kind).toBe('subscription')
    const refund = await classify({ type: 'refund', source: { amount: 450, currency: 'gbp', payment_intent: 'pi_1', metadata: {} } } as never, async (pi) => pi === 'pi_1')
    expect(refund).toMatchObject({ kind: 'refund', refundOf: 'book', chargeAmount: -450 })
  })
})

describe('FINANCE · routes', () => {
  it('owner only: a coach gets 403', async () => {
    role = 'user'
    expect((await call('GET', '/api/admin/finance/pnl?from=2026-10&to=2026-10')).statusCode).toBe(403)
    expect((await call('POST', '/api/admin/finance/expenses', {})).statusCode).toBe(403)
  })

  it('a foreign-currency expense needs its INR amount; an INR one copies it', async () => {
    const bad = await call('POST', '/api/admin/finance/expenses', { date: '2026-10-01', category: 'hosting', amount: 1200, currency: 'usd' })
    expect(bad.statusCode).toBe(422)
    expect(JSON.stringify(bad.json())).toMatch(/INR that left the account/)
    mock.financeExpense.create.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ id: 3, ...data })) as never)
    const ok = await call('POST', '/api/admin/finance/expenses', { date: '2026-10-01', category: 'hosting', supplier: 'Hetzner', amount: 250_000, currency: 'inr' })
    expect(ok.statusCode).toBe(201)
    expect(mock.financeExpense.create.mock.calls[0][0].data).toMatchObject({ currency: 'INR', amount: 250_000, amountInr: 250_000, createdById: 1 })
  })

  it('the P&L route returns months and a total', async () => {
    mock.financeExpense.findMany.mockResolvedValue([] as never)
    mock.financeTransaction.findMany.mockResolvedValue([] as never)
    mock.collaboratorCommission.findMany.mockResolvedValue([] as never)
    const res = await call('GET', '/api/admin/finance/pnl?from=2026-08&to=2026-10')
    expect(res.statusCode).toBe(200)
    expect(res.json().months.map((m: { month: string }) => m.month)).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(res.json().currency).toBe('INR')
  })
})
