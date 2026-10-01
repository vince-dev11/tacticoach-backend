// FT-1 · migration 42_free_trial. Read as text: there is no database in the
// sandbox, and what matters at release is what this SQL does to real rows.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const path = 'prisma/migrations/42_free_trial/migration.sql'
const sql = existsSync(path) ? readFileSync(path, 'utf8') : ''

describe('FT-1 · migration 42_free_trial', () => {
  it('adds the trial end and reminder columns to users', () => {
    expect(sql).toMatch(/ALTER TABLE `users`[\s\S]*ADD COLUMN `free_trial_ends_at` DATETIME\(3\) NULL/)
    expect(sql).toMatch(/ADD COLUMN `free_trial_reminder_sent_at` DATETIME\(3\) NULL/)
  })
  it('gives every existing non-player account 14 days from release', () => {
    expect(sql).toMatch(/UPDATE `users` SET `free_trial_ends_at` = DATE_ADD\(NOW\(3\), INTERVAL 14 DAY\)\s+WHERE `account_type` <> 'player'/)
  })
  it('creates free_usage and backfills it from what each coach already has', () => {
    expect(sql).toMatch(/CREATE TABLE `free_usage`/)
    for (const t of ['canvas_boards', 'drill_sheets', 'training_sessions', 'season_plans', 'ebooks']) {
      expect(sql).toContain(t)
    }
    expect(sql).toMatch(/`is_match` = false/)
  })
})
