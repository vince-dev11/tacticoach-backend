// ROYALTIES (25 Nov 2026, owner): TactiCoach is paid 100% of each book sale
// (Paddle pays us) and pays the author side — 70% of the price without tax —
// to authors and co-authors from its bank every month. This is the ledger.
//
// Rules:
//   - A sale counts towards a payout once the 14-day refund window has passed
//     (ROYALTY_HOLD_DAYS), so we never pay out money that comes back.
//   - Owed = the payee's share of cleared sales that are still paid − payouts
//     recorded. A sale refunded AFTER it was paid out simply stops counting,
//     so the next figure is smaller (it may go below zero and carry over).
//   - Co-authors get their sharePercent of the author side; the lead author
//     the rest (the authoring screen says so).
//   - Recording a payout moves no money. Bank account numbers are never stored.

import { db } from '../../config/database.js'

export const ROYALTY_HOLD_DAYS = 14
export const ROYALTY_MIN_PAYOUT_PENCE = 1000
export const PAYEE_METHODS = ['bank', 'paypal', 'other'] as const

export class RoyaltyError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message)
  }
}

interface Coauthor { userId: number | null; sharePercent: number; acceptedAt: Date | null }

/** How one sale's author side is shared. The lead author gets the rounding. */
export function payeeShares(authorSidePence: number, authorId: number, coauthors: Coauthor[]): Map<number, number> {
  const out = new Map<number, number>()
  let given = 0
  for (const c of coauthors) {
    if (!c.userId || !c.acceptedAt || c.sharePercent <= 0) continue
    const share = Math.floor((authorSidePence * c.sharePercent) / 100)
    out.set(c.userId, (out.get(c.userId) ?? 0) + share)
    given += share
  }
  out.set(authorId, (out.get(authorId) ?? 0) + authorSidePence - given)
  return out
}

interface SaleRow {
  id: number
  status: string
  paidAt: Date | null
  pricePence: number
  authorSharePence: number
  ebook: { id: number; title: string; authorId: number; coauthors: Coauthor[] }
}

/** Real sales only: checkout through a gateway (never test purchases or gifts). */
async function sales(where: Record<string, unknown> = {}): Promise<SaleRow[]> {
  const rows = await db.ebookPurchase.findMany({
    where: {
      source: 'checkout',
      status: { in: ['paid', 'refunded'] },
      provider: { notIn: ['test'] },
      NOT: { provider: null },
      paidAt: { not: null },
      ...where,
    },
    orderBy: { paidAt: 'asc' },
    select: {
      id: true, status: true, paidAt: true, pricePence: true, authorSharePence: true,
      ebook: { select: { id: true, title: true, authorId: true, coauthors: { select: { userId: true, sharePercent: true, acceptedAt: true } } } },
    },
  })
  return (rows ?? []) as SaleRow[]
}

export interface PayeeBalance {
  userId: number
  salesCount: number
  /** Share of sales past the refund window and still paid. */
  clearedPence: number
  /** Share of sales still inside the refund window. */
  pendingPence: number
  paidOutPence: number
  /** cleared − paid out. Can be below zero after a late refund; it carries over. */
  owedPence: number
  lastPayoutAt: Date | null
}

function emptyBalance(userId: number): PayeeBalance {
  return { userId, salesCount: 0, clearedPence: 0, pendingPence: 0, paidOutPence: 0, owedPence: 0, lastPayoutAt: null }
}

/** Every payee's balance (or one payee's). */
export async function balances(onlyUserId?: number, now = new Date()): Promise<Map<number, PayeeBalance>> {
  const cutoff = new Date(now.getTime() - ROYALTY_HOLD_DAYS * 86_400_000)
  const out = new Map<number, PayeeBalance>()
  const get = (id: number) => {
    let b = out.get(id)
    if (!b) out.set(id, (b = emptyBalance(id)))
    return b
  }
  for (const sale of await sales()) {
    if (sale.status !== 'paid') continue
    for (const [userId, share] of payeeShares(sale.authorSharePence, sale.ebook.authorId, sale.ebook.coauthors)) {
      if (onlyUserId && userId !== onlyUserId) continue
      const b = get(userId)
      b.salesCount++
      if (sale.paidAt && sale.paidAt <= cutoff) b.clearedPence += share
      else b.pendingPence += share
    }
  }
  const payouts = await db.authorPayout.findMany({
    where: { voidedAt: null, userId: onlyUserId ? onlyUserId : { not: null } },
    select: { userId: true, amountPence: true, paidAt: true },
  })
  for (const p of payouts ?? []) {
    if (!p.userId) continue
    const b = get(p.userId)
    b.paidOutPence += p.amountPence
    if (!b.lastPayoutAt || p.paidAt > b.lastPayoutAt) b.lastPayoutAt = p.paidAt
  }
  for (const b of out.values()) b.owedPence = b.clearedPence - b.paidOutPence
  return out
}

/** One author's figures for their dashboard. */
export async function authorBalance(userId: number) {
  const b = (await balances(userId)).get(userId) ?? emptyBalance(userId)
  return { ...b, holdDays: ROYALTY_HOLD_DAYS, minPayoutPence: ROYALTY_MIN_PAYOUT_PENCE }
}

/** Admin → Author payouts: everyone who has earned, with who they are for payment. */
export async function payoutRoster() {
  const map = await balances()
  const ids = [...map.keys()]
  if (!ids.length) return { holdDays: ROYALTY_HOLD_DAYS, minPayoutPence: ROYALTY_MIN_PAYOUT_PENCE, payees: [] }
  const [users, payees] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, surname: true, email: true } }),
    db.authorPayee.findMany({ where: { userId: { in: ids } } }),
  ])
  const byUser = new Map((users ?? []).map((u) => [u.id, u]))
  const byPayee = new Map((payees ?? []).map((p) => [p.userId, p]))
  const rows = ids.map((id) => {
    const b = map.get(id)!
    const payee = byPayee.get(id) ?? null
    return {
      ...b,
      user: byUser.get(id) ?? null,
      payee: payee && {
        legalName: payee.legalName, country: payee.country, method: payee.method,
        taxFormReceived: payee.taxFormReceived, note: payee.note,
      },
      payable: b.owedPence >= ROYALTY_MIN_PAYOUT_PENCE && !!payee,
    }
  })
  rows.sort((a, b) => b.owedPence - a.owedPence)
  return { holdDays: ROYALTY_HOLD_DAYS, minPayoutPence: ROYALTY_MIN_PAYOUT_PENCE, payees: rows }
}

/** Record money already sent from the bank. Never more than is owed. */
export async function recordPayout(adminId: number, input: { userId: number; amountPence: number; reference: string; paidAt?: Date; note?: string | null }) {
  if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) throw new RoyaltyError(422, 'amount', 'Enter the amount paid, in pence, above zero.')
  const reference = input.reference.trim()
  if (!reference) throw new RoyaltyError(422, 'reference', 'Add the bank or PayPal reference, so the payment can be matched.')
  const payee = await db.authorPayee.findUnique({ where: { userId: input.userId } })
  if (!payee) throw new RoyaltyError(409, 'no_payee', 'Add their legal name and country first — the accounts need them.')
  const b = (await balances(input.userId)).get(input.userId)
  const owed = b?.owedPence ?? 0
  if (input.amountPence > owed) throw new RoyaltyError(409, 'over_owed', `They are owed ${owed} pence; a payout can't be more than that.`)
  const paidAt = input.paidAt ?? new Date()
  if (paidAt.getTime() > Date.now() + 86_400_000) throw new RoyaltyError(422, 'date', 'The payment date can’t be in the future.')
  return db.authorPayout.create({
    data: {
      userId: input.userId, payeeName: payee.legalName, amountPence: input.amountPence, currency: 'GBP',
      paidAt, reference: reference.slice(0, 120), note: input.note?.trim().slice(0, 255) || null, createdById: adminId,
    },
  })
}

/** A payout recorded by mistake: kept, marked void, no longer counted. */
export async function voidPayout(id: number) {
  const row = await db.authorPayout.findUnique({ where: { id } })
  if (!row) throw new RoyaltyError(404, 'not_found', 'Payout not found.')
  if (row.voidedAt) return row
  return db.authorPayout.update({ where: { id }, data: { voidedAt: new Date() } })
}

export async function payoutsFor(userId: number) {
  return db.authorPayout.findMany({
    where: { userId },
    orderBy: { paidAt: 'desc' },
    select: { id: true, amountPence: true, currency: true, paidAt: true, reference: true, note: true, voidedAt: true, createdAt: true },
  })
}

export async function savePayee(userId: number, input: { legalName: string; country: string; method: string; taxFormReceived: boolean; note?: string | null }) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!user) throw new RoyaltyError(404, 'not_found', 'Account not found.')
  const data = {
    legalName: input.legalName.trim().slice(0, 150),
    country: input.country.trim().toUpperCase().slice(0, 2),
    method: (PAYEE_METHODS as readonly string[]).includes(input.method) ? input.method : 'other',
    taxFormReceived: input.taxFormReceived,
    note: input.note?.trim().slice(0, 255) || null,
  }
  return db.authorPayee.upsert({ where: { userId }, update: data, create: { userId, ...data } })
}

function csvCell(v: unknown): string {
  const s = String(v ?? '')
  // Spreadsheet formula injection: a leading = + - @ runs as a formula.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The month's sales by payee and the payouts made, for the CA. `month` = "2026-11". */
export async function monthCsv(month: string): Promise<string> {
  const m = month.match(/^(\d{4})-(\d{2})$/)
  if (!m) throw new RoyaltyError(422, 'month', 'Month must look like 2026-11.')
  const from = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
  const to = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1))
  const [rows, payouts] = await Promise.all([
    sales({ paidAt: { gte: from, lt: to } }),
    db.authorPayout.findMany({ where: { paidAt: { gte: from, lt: to } }, orderBy: { paidAt: 'asc' } }),
  ])
  const ids = new Set<number>()
  for (const r of rows) for (const id of payeeShares(r.authorSharePence, r.ebook.authorId, r.ebook.coauthors).keys()) ids.add(id)
  const users = ids.size ? await db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, surname: true, email: true } }) : []
  const name = new Map((users ?? []).map((u) => [u.id, `${u.name} ${u.surname}`.trim()]))
  const lines = [['type', 'date', 'order', 'book', 'payee', 'payee_email', 'sale_pence', 'payee_share_pence', 'status', 'reference'].join(',')]
  const email = new Map((users ?? []).map((u) => [u.id, u.email]))
  for (const r of rows) {
    for (const [uid, share] of payeeShares(r.authorSharePence, r.ebook.authorId, r.ebook.coauthors)) {
      lines.push(['sale', r.paidAt?.toISOString().slice(0, 10), r.id, r.ebook.title, name.get(uid) ?? uid, email.get(uid) ?? '', r.pricePence, share, r.status, ''].map(csvCell).join(','))
    }
  }
  for (const p of payouts ?? []) {
    lines.push(['payout', p.paidAt.toISOString().slice(0, 10), '', '', p.payeeName, '', '', p.voidedAt ? 0 : p.amountPence, p.voidedAt ? 'void' : 'paid', p.reference].map(csvCell).join(','))
  }
  return lines.join('\n') + '\n'
}
