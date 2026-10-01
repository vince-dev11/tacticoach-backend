// One-off, at release of migration 42_free_trial (1 Oct 2026): tell every
// coach whose access is now the free trial that it runs for 14 days.
//
//   npx tsx scripts/notify-free-trial-start.ts --dry-run   (lists who would get it)
//   npx tsx scripts/notify-free-trial-start.ts             (sends)
//
// Only coaches on the free trial are mailed — not paying coaches, club seats,
// collaborators, the owner or players (getEntitlements decides, so this agrees
// with what the app shows them). One mail every 300 ms.

import { db } from '../src/config/database.js'
import { getEntitlements } from '../src/lib/entitlements.js'
import { sendFreeTrialStartedEmail } from '../src/lib/emails.js'

const dry = process.argv.includes('--dry-run')

const users = await db.user.findMany({
  where: { accountType: { not: 'player' }, freeTrialEndsAt: { not: null } },
  select: { id: true, name: true, email: true, freeTrialEndsAt: true },
  orderBy: { id: 'asc' },
})

let n = 0
for (const u of users) {
  const ent = await getEntitlements(u.id)
  if (ent.subscriptionStatus !== 'free_trial') continue
  n += 1
  if (dry) {
    console.log(`${u.email}\t${u.freeTrialEndsAt!.toISOString()}`)
    continue
  }
  await sendFreeTrialStartedEmail(u, u.freeTrialEndsAt!)
  await new Promise((r) => setTimeout(r, 300))
}

console.log(`${dry ? 'Would send' : 'Sent'} ${n} of ${users.length} coach accounts`)
await db.$disconnect()
