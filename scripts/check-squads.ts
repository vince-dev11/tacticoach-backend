/**
 * Did migration 22's back-fill land?
 *
 * Uses the Prisma client rather than the mysql CLI, so it authenticates with
 * DATABASE_URL from .env — no separate database password to remember.
 *
 * `players_with_no_squad` MUST be 0. A squad-less row is invisible to every
 * read the app now makes: the player is not deleted, but their coach opens the
 * squad editor and finds them gone.
 *
 *   npx --yes tsx scripts/check-squads.ts
 */

import { db } from '../src/config/database.js'

const [players, squads, orphans, coaches] = await Promise.all([
  db.squadPlayer.count(),
  db.squad.count(),
  db.squadPlayer.count({ where: { squadId: null } }),
  db.squadPlayer.findMany({ distinct: ['userId'], select: { userId: true } }),
])

console.log({
  players,
  squads,
  coaches_with_players: coaches.length,
  players_with_no_squad: orphans,
})
console.log(orphans === 0 ? '\nOK — every player has a squad.' : '\nPROBLEM — fix before anyone edits a squad.')

await db.$disconnect()
