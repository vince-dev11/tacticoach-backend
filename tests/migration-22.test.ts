// The squads back-fill.
//
// Migration SQL runs once, against real coaches' data, and is not something
// you get to retry. Nothing else in this suite can see it: the unit tests mock
// Prisma, so a back-fill that orphans every player would pass all of them.
//
// So this reads the file and checks the handful of properties that make it
// safe. It is not a substitute for running it against a copy of production —
// it is the floor, not the ceiling.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SQL = readFileSync(
  resolve(process.cwd(), 'prisma/migrations/22_squads/migration.sql'),
  'utf8',
)

/** Strip comments so `--` prose never satisfies a check about the statements. */
const STATEMENTS = SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

describe('migration 22 — squads', () => {
  it('reads the file at all', () => {
    expect(STATEMENTS).toContain('CREATE TABLE `squads`')
  })

  it('gives every coach who has players a squad', () => {
    // The INSERT is driven by an EXISTS over squad_players, not by all users:
    // a squad for every account that ever signed up is a table full of rows
    // nobody asked for.
    expect(STATEMENTS).toMatch(/INSERT INTO `squads`[\s\S]*FROM `users`[\s\S]*WHERE EXISTS/)
    expect(STATEMENTS).toMatch(/EXISTS \(SELECT 1 FROM `squad_players`/)
  })

  it('moves every existing player into that squad', () => {
    // A player with a NULL squad_id is invisible to every squad-scoped read —
    // which is every read there now is.
    expect(STATEMENTS).toMatch(/UPDATE `squad_players`[\s\S]*SET p\.`squad_id` = s\.`id`/)
    expect(STATEMENTS).toMatch(/JOIN `squads` s ON s\.`user_id` = p\.`user_id`/)
  })

  it('back-fills BEFORE adding the foreign key', () => {
    // Order matters: the constraint has to land on data that already points
    // somewhere real.
    const update = STATEMENTS.indexOf('SET p.`squad_id` = s.`id`')
    const fk = STATEMENTS.indexOf('squad_players_squad_id_fkey')
    expect(update).toBeGreaterThan(-1)
    expect(fk).toBeGreaterThan(update)
  })

  it('keeps archived players, because their rows hold note history', () => {
    // The back-fill must NOT filter on archived_at. An archived row carries a
    // player's feedback; leaving it squad-less strands that record.
    const backfill = STATEMENTS.slice(
      STATEMENTS.indexOf('UPDATE `squad_players`'),
      STATEMENTS.indexOf('squad_players_squad_id_fkey'),
    )
    expect(backfill).not.toContain('archived_at')
  })

  it('leaves every existing session unassigned rather than guessing', () => {
    // A session's age_group is a label the coach typed. Matching on it would
    // file sessions under the wrong team, quietly.
    expect(STATEMENTS).toMatch(/ALTER TABLE `training_sessions`[\s\S]*ADD COLUMN `squad_id` INT NULL/)
    expect(STATEMENTS).not.toMatch(/UPDATE `training_sessions`/)
  })

  it('never deletes a session when a squad is archived', () => {
    // SetNull on the session FK, Cascade on the player FK: players belong to a
    // team, a session is a record of work that happened.
    expect(STATEMENTS).toMatch(
      /training_sessions_squad_id_fkey[\s\S]*?ON DELETE SET NULL/,
    )
  })

  it('does not touch the unique that stops a note history splitting', () => {
    // squad_players stays UNIQUE(user_id, player_user_id). Making it per-squad
    // would allow two rows for one child under one coach — and each row owns
    // half their season.
    expect(STATEMENTS).not.toMatch(/DROP INDEX `squad_players_user_id_player_user_id_key`/)
    expect(STATEMENTS).not.toMatch(/ADD UNIQUE[^;]*`squad_id`[^;]*`player_user_id`/)
  })
})
