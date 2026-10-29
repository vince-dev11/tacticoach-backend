// FINANCE · expenses (28 Oct 2026, owner). Categories and suppliers; a
// repeating expense (monthly / yearly) is a template whose occurrences are
// written up to today — idempotent thanks to the (repeatOfId, date) key.
import { db } from '../../../config/database.js'

export const EXPENSE_CATEGORIES = [
  'hosting', 'software', 'marketing', 'contractors', 'fees', 'legal', 'equipment', 'travel', 'other',
] as const

/** Next occurrence: the same day of the month (clamped: 31 Jan → 28/29 Feb). */
export function nextDate(d: Date, repeat: 'monthly' | 'yearly', n: number): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  const ty = repeat === 'yearly' ? y + n : y + Math.floor((m + n) / 12)
  const tm = repeat === 'yearly' ? m : (m + n) % 12
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  return new Date(Date.UTC(ty, tm, Math.min(day, last)))
}

/** The occurrence dates of a template after its first day, up to `until` (inclusive). */
export function occurrences(start: Date, repeat: 'monthly' | 'yearly', until: Date): Date[] {
  const out: Date[] = []
  for (let n = 1; n < 600; n++) {
    const d = nextDate(start, repeat, n)
    if (d > until) break
    out.push(d)
  }
  return out
}

/** Write any missing occurrences of repeating expenses up to `today`. */
export async function materialiseRepeats(today = new Date()): Promise<number> {
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const templates = await db.financeExpense.findMany({ where: { repeat: { not: 'none' }, repeatOfId: null } })
  let made = 0
  for (const t of templates) {
    const until = t.repeatUntil && t.repeatUntil < day ? t.repeatUntil : day
    const dates = occurrences(t.date, t.repeat as 'monthly' | 'yearly', until)
    if (!dates.length) continue
    const res = await db.financeExpense.createMany({
      data: dates.map((date) => ({
        date, category: t.category, supplier: t.supplier, description: t.description,
        amount: t.amount, currency: t.currency, amountInr: t.amountInr, repeat: 'none' as const,
        repeatOfId: t.id, createdById: t.createdById,
      })),
      skipDuplicates: true,
    })
    made += res.count
  }
  return made
}
