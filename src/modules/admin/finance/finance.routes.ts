// /api/admin/finance/* — owner-only, mounted inside adminRoutes (authGuard +
// requireOwner already apply). FINANCE (28 Oct 2026, owner): Stripe ledger,
// expenses and the profit and loss, in INR, cash basis.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../../config/database.js'
import { stripeConfigured } from '../../../config/stripe.js'
import { buildPnl, monthsBetween, type PnlTxn } from './pnl.js'
import { EXPENSE_CATEGORIES, materialiseRepeats } from './expenses.js'
import { syncFromStripe } from './stripe-sync.js'

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Use YYYY-MM' })
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use YYYY-MM-DD' })

const ExpenseBody = z.object({
  date: Day,
  category: z.enum(EXPENSE_CATEGORIES, { message: 'Pick a category' }),
  supplier: z.string().trim().max(120).default(''),
  description: z.string().trim().max(255).default(''),
  /** Minor unit (paise, pence, cents). */
  amount: z.number().int().min(1, { message: 'Enter an amount' }).max(1_000_000_000),
  currency: z.string().trim().length(3, { message: 'Use a 3-letter currency code' }).transform((c) => c.toUpperCase()),
  /** Required when the currency is not INR: the rupees that left the account. */
  amountInr: z.number().int().min(1).max(1_000_000_000).optional(),
  repeat: z.enum(['none', 'monthly', 'yearly']).default('none'),
  repeatUntil: Day.nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.currency !== 'INR' && !v.amountInr) ctx.addIssue({ code: 'custom', path: ['amountInr'], message: 'Enter the amount in INR that left the account' })
})

const toDate = (d: string) => new Date(`${d}T00:00:00.000Z`)
const startOf = (month: string) => new Date(`${month}-01T00:00:00.000Z`)
/** First moment of the month after `month`, in IST (UTC+5:30) as UTC. */
const endOfIst = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1) - 330 * 60_000)
}
const startOfIst = (month: string) => new Date(startOf(month).getTime() - 330 * 60_000)

function expenseData(b: z.infer<typeof ExpenseBody>) {
  return {
    date: toDate(b.date), category: b.category, supplier: b.supplier, description: b.description,
    amount: b.amount, currency: b.currency, amountInr: b.currency === 'INR' ? b.amount : b.amountInr!,
    repeat: b.repeat, repeatUntil: b.repeatUntil ? toDate(b.repeatUntil) : null,
  }
}

export async function financeRoutes(app: FastifyInstance) {
  app.get('/finance/status', async () => {
    const [count, last] = await Promise.all([
      db.financeTransaction.count(),
      db.financeTransaction.findFirst({ orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
    ])
    return { stripeConfigured: stripeConfigured(), transactions: count, lastTransactionAt: last?.occurredAt ?? null, categories: EXPENSE_CATEGORIES }
  })

  // The owner's "Sync with Stripe". Safe to press twice.
  app.post('/finance/sync', async (_request, reply) => {
    if (!stripeConfigured()) return reply.status(409).send({ message: 'Stripe is not configured on this server.' })
    try {
      return await syncFromStripe()
    } catch (err) {
      request_log(app, err)
      return reply.status(502).send({ message: 'Stripe could not be reached. Try again in a minute.' })
    }
  })

  app.get('/finance/pnl', async (request) => {
    const q = z.object({ from: Month, to: Month }).parse(request.query)
    const [from, to] = q.from <= q.to ? [q.from, q.to] : [q.to, q.from]
    await materialiseRepeats()
    const months = monthsBetween(from, to)
    const [txns, expenses, commissions] = await Promise.all([
      db.financeTransaction.findMany({ where: { occurredAt: { gte: startOfIst(from), lt: endOfIst(to) } } }),
      db.financeExpense.findMany({
        // Templates count on their own first day; occurrences on theirs.
        where: { date: { gte: startOf(from), lt: new Date(endOfIst(to).getTime() + 330 * 60_000) } },
        select: { date: true, category: true, amountInr: true },
      }),
      db.collaboratorCommission.findMany({
        where: { createdAt: { gte: startOfIst(from), lt: endOfIst(to) } },
        select: { createdAt: true, commissionAmount: true, currency: true, reversedAt: true },
      }),
    ])
    const intents = [...new Set(txns.filter((t) => t.paymentIntent && (t.kind === 'book' || t.refundOf === 'book')).map((t) => t.paymentIntent!))]
    const purchases = intents.length
      ? await db.ebookPurchase.findMany({ where: { providerRef: { in: intents } }, select: { providerRef: true, authorSharePercent: true } })
      : []
    const bookShare = new Map(purchases.map((p) => [p.providerRef!, p.authorSharePercent]))
    const currency = txns[0]?.currency?.toUpperCase() ?? 'INR'
    return { currency, ...buildPnl(months, { txns: txns as unknown as PnlTxn[], bookShare, expenses, commissions }) }
  })

  app.get('/finance/transactions', async (request) => {
    const q = z.object({ month: Month }).parse(request.query)
    const rows = await db.financeTransaction.findMany({
      where: { occurredAt: { gte: startOfIst(q.month), lt: endOfIst(q.month) } },
      orderBy: { occurredAt: 'desc' },
      take: 1000,
    })
    return { transactions: rows }
  })

  app.get('/finance/expenses', async (request) => {
    const q = z.object({ month: Month.optional(), templates: z.enum(['1']).optional() }).parse(request.query)
    await materialiseRepeats()
    if (q.templates) {
      return { expenses: await db.financeExpense.findMany({ where: { repeat: { not: 'none' }, repeatOfId: null }, orderBy: { date: 'desc' } }) }
    }
    const month = q.month ?? new Date().toISOString().slice(0, 7)
    const [y, m] = month.split('-').map(Number)
    const expenses = await db.financeExpense.findMany({
      where: { date: { gte: startOf(month), lt: new Date(Date.UTC(y, m, 1)) } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    })
    return { expenses }
  })

  app.post('/finance/expenses', async (request, reply) => {
    const body = ExpenseBody.parse(request.body)
    const userId = (request.user as { sub: number }).sub
    const created = await db.financeExpense.create({ data: { ...expenseData(body), createdById: userId } })
    if (created.repeat !== 'none') await materialiseRepeats()
    return reply.status(201).send(created)
  })

  app.patch('/finance/expenses/:id', async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params)
    const body = ExpenseBody.parse(request.body)
    const found = await db.financeExpense.findUnique({ where: { id }, select: { id: true, repeatOfId: true } })
    if (!found) return reply.status(404).send({ message: 'Expense not found' })
    // An occurrence of a repeating expense is a plain expense: it can't start repeating itself.
    const data = expenseData(body)
    const updated = await db.financeExpense.update({ where: { id }, data: found.repeatOfId ? { ...data, repeat: 'none', repeatUntil: null } : data })
    if (updated.repeat !== 'none') await materialiseRepeats()
    return updated
  })

  // Deleting a repeating expense stops it; the months already paid stay.
  app.delete('/finance/expenses/:id', async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params)
    const found = await db.financeExpense.findUnique({ where: { id }, select: { id: true } })
    if (!found) return reply.status(404).send({ message: 'Expense not found' })
    await db.financeExpense.delete({ where: { id } })
    return reply.status(204).send()
  })
}

function request_log(app: FastifyInstance, err: unknown) {
  app.log.error({ err }, 'finance sync failed')
}
