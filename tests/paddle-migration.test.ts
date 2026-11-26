// PADDLE / ROYALTIES (25 Nov 2026) · migration 69 only adds: a column and four
// tables. Nothing existing is dropped or rewritten.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync('prisma/migrations/69_paddle_billing/migration.sql', 'utf8')

describe('PADDLE · migration 69', () => {
  it('adds the Paddle customer column and the four new tables', () => {
    expect(sql).toMatch(/ALTER TABLE `users` ADD COLUMN `paddle_customer_id` VARCHAR\(64\) NULL/)
    for (const t of ['paddle_events', 'paddle_catalog', 'author_payouts', 'author_payees']) expect(sql).toContain(`CREATE TABLE \`${t}\``)
  })
  it('never drops, deletes or updates existing data', () => {
    expect(sql).not.toMatch(/\bDROP\b|DELETE FROM|^UPDATE |TRUNCATE/im)
  })
  it('a payout record outlives a deleted account (SET NULL, name kept)', () => {
    expect(sql).toMatch(/author_payouts_user_id_fkey.*ON DELETE SET NULL/)
    expect(sql).toMatch(/`payee_name` VARCHAR\(150\) NOT NULL/)
  })
})
