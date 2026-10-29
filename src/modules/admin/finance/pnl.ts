// FINANCE (28 Oct 2026, owner): the profit and loss, as pure arithmetic so it
// can be tested without a database. Cash basis (a payment counts in the month
// it was paid) and reported in INR (paise) — the business is in India and
// Stripe India settles in INR.
//
// Per month:
//   Revenue        = subscriptions + book sales + refunds (negative)
//   Costs of sales = Stripe fees + authors' share of book sales + partner commission
//   Gross profit   = revenue − costs of sales
//   Expenses       = what was spent, by category
//   Profit         = gross profit − expenses
// VAT is not separated: Stripe Tax is not switched on, so no tax is collected.

export type TxnKind = 'subscription' | 'book' | 'refund' | 'fee' | 'other'

export interface PnlTxn {
  kind: TxnKind
  refundOf: TxnKind | null
  /** Settlement currency, minor unit; negative for refunds and fee lines. */
  amount: number
  /** Stripe's fee on the line (a cost when positive). */
  fee: number
  currency: string
  chargeAmount: number | null
  chargeCurrency: string | null
  paymentIntent: string | null
  occurredAt: Date
}

export interface PnlExpense { date: Date; category: string; amountInr: number }
export interface PnlCommission { createdAt: Date; commissionAmount: number; currency: string; reversedAt: Date | null }

export interface PnlMonth {
  month: string
  subscriptions: number
  books: number
  refunds: number
  other: number
  revenue: number
  stripeFees: number
  authorShare: number
  partnerCommission: number
  grossProfit: number
  expenses: Record<string, number>
  totalExpenses: number
  profit: number
  /** Partner commission in a currency we could not convert this month (no rate). */
  unconvertedCommission: number
}

/** The month a moment belongs to in India (IST, UTC+5:30). */
export function istMonth(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 7)
}
/** A DATE column (expense day) is already a calendar day. */
export function dayMonth(d: Date): string {
  return d.toISOString().slice(0, 7)
}

/** Every month from `from` to `to` inclusive ('YYYY-MM'). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m === 13) { m = 1; y += 1 }
    if (out.length > 240) break
  }
  return out
}

/**
 * Rate from a foreign currency (GBP) into the settlement currency for a month:
 * what Stripe actually converted that month (settled ÷ charged). Falls back
 * to the closest earlier month that had a sale, then any month.
 */
export function ratesByMonth(txns: PnlTxn[], from = 'gbp'): Map<string, number> {
  const sums = new Map<string, { settled: number; charged: number }>()
  for (const t of txns) {
    if (t.kind !== 'subscription' && t.kind !== 'book') continue
    if ((t.chargeCurrency ?? '').toLowerCase() !== from || !t.chargeAmount) continue
    const k = istMonth(t.occurredAt)
    const s = sums.get(k) ?? { settled: 0, charged: 0 }
    s.settled += t.amount
    s.charged += t.chargeAmount
    sums.set(k, s)
  }
  const out = new Map<string, number>()
  for (const [k, s] of sums) if (s.charged > 0) out.set(k, s.settled / s.charged)
  return out
}

function rateFor(rates: Map<string, number>, month: string): number | null {
  if (rates.has(month)) return rates.get(month)!
  const earlier = [...rates.keys()].filter((k) => k <= month).sort()
  if (earlier.length) return rates.get(earlier[earlier.length - 1])!
  const any = [...rates.keys()].sort()
  return any.length ? rates.get(any[0])! : null
}

export function buildPnl(
  months: string[],
  input: {
    txns: PnlTxn[]
    /** Payment intent → the author's share in percent (70 by default). */
    bookShare: Map<string, number>
    expenses: PnlExpense[]
    commissions: PnlCommission[]
  },
): { months: PnlMonth[]; total: PnlMonth } {
  const blank = (month: string): PnlMonth => ({
    month, subscriptions: 0, books: 0, refunds: 0, other: 0, revenue: 0, stripeFees: 0, authorShare: 0,
    partnerCommission: 0, grossProfit: 0, expenses: {}, totalExpenses: 0, profit: 0, unconvertedCommission: 0,
  })
  const rows = new Map(months.map((m) => [m, blank(m)]))
  const share = (pi: string | null) => (pi && input.bookShare.has(pi) ? input.bookShare.get(pi)! : 70)

  for (const t of input.txns) {
    const r = rows.get(istMonth(t.occurredAt))
    if (!r) continue
    r.stripeFees += t.fee
    if (t.kind === 'subscription') r.subscriptions += t.amount
    else if (t.kind === 'book') { r.books += t.amount; r.authorShare += Math.round((t.amount * share(t.paymentIntent)) / 100) }
    else if (t.kind === 'refund') {
      r.refunds += t.amount
      // A refunded book sale takes the author's share back with it.
      if (t.refundOf === 'book') r.authorShare += Math.round((t.amount * share(t.paymentIntent)) / 100)
    } else if (t.kind === 'fee') r.stripeFees += -t.amount
    else r.other += t.amount
  }

  const rates = ratesByMonth(input.txns)
  for (const c of input.commissions) {
    if (c.reversedAt) continue
    const month = istMonth(c.createdAt)
    const r = rows.get(month)
    if (!r) continue
    if (c.currency.toLowerCase() === 'inr') { r.partnerCommission += c.commissionAmount; continue }
    const rate = c.currency.toLowerCase() === 'gbp' ? rateFor(rates, month) : null
    if (rate === null) r.unconvertedCommission += c.commissionAmount
    else r.partnerCommission += Math.round(c.commissionAmount * rate)
  }

  for (const e of input.expenses) {
    const r = rows.get(dayMonth(e.date))
    if (!r) continue
    r.expenses[e.category] = (r.expenses[e.category] ?? 0) + e.amountInr
    r.totalExpenses += e.amountInr
  }

  const total = blank('total')
  for (const r of rows.values()) {
    r.revenue = r.subscriptions + r.books + r.refunds + r.other
    r.grossProfit = r.revenue - r.stripeFees - r.authorShare - r.partnerCommission
    r.profit = r.grossProfit - r.totalExpenses
    for (const k of ['subscriptions', 'books', 'refunds', 'other', 'revenue', 'stripeFees', 'authorShare', 'partnerCommission', 'grossProfit', 'totalExpenses', 'profit', 'unconvertedCommission'] as const) {
      total[k] += r[k]
    }
    for (const [k, v] of Object.entries(r.expenses)) total.expenses[k] = (total.expenses[k] ?? 0) + v
  }
  return { months: [...rows.values()], total }
}
