/**
 * Which feedback query is throwing?
 *
 * The API's error handler deliberately replaces 500s with "Internal Server
 * Error" so Prisma messages (which name tables, columns and hosts) never reach
 * a browser. That is right, and it is also why the player screen tells you
 * nothing useful. This runs the same three queries directly and prints the
 * real error for whichever one fails.
 *
 *   npx tsx scripts/diagnose-feedback.ts <playerUserId>
 *
 * Any user id will do — an id that matches nothing still proves the query
 * itself is valid against the live schema, which is the thing in doubt.
 *
 * Safe to run against production: every query here is a read.
 */

import { db } from '../src/config/database.js'
import { getEntitlements } from '../src/lib/entitlements.js'
import { linksForPlayer, notesForPlayer } from '../src/modules/feedback/feedback.service.js'
import { coachIdsFor } from '../src/lib/club-staff.js'

const userId = Number(process.argv[2] ?? 1)

async function step(name: string, run: () => Promise<unknown>) {
  try {
    const result = await run()
    const size = Array.isArray(result) ? `${result.length} row(s)` : 'ok'
    console.log(`  PASS  ${name} — ${size}`)
    return true
  } catch (err) {
    console.log(`  FAIL  ${name}`)
    console.log('')
    console.log(err instanceof Error ? (err.stack ?? err.message) : String(err))
    console.log('')
    return false
  }
}

async function main() {
  console.log(`\nChecking the feedback queries for user ${userId}\n`)

  // Ordered so the first failure is also the most informative: entitlements
  // reads the migration-20 columns, so if it passes the migration ran.
  await step('getEntitlements       (squad_players.player_user_id, link_status)', () =>
    getEntitlements(userId),
  )
  await step('coachIdsFor           (club_members.role — migration 21)', () => coachIdsFor(userId))
  await step('linksForPlayer        (GET /api/feedback/links)', () => linksForPlayer(userId))
  await step('notesForPlayer        (GET /api/feedback/my-notes)', () => notesForPlayer(userId))

  console.log('')
  await db.$disconnect()
}

void main()
