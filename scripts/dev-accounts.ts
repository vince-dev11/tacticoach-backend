// Three ready-to-use accounts for a LOCAL database: owner, club and coach.
//
//   npx tsx scripts/dev-accounts.ts
//   DEV_PASSWORD='your-pick' npx tsx scripts/dev-accounts.ts   (same password for all three)
//
// Each run gives every account a NEW random password and prints it once, in
// your terminal only. Nothing is hard-coded, so there is no known password
// sitting in the repo for anyone to try against a real server — and the
// script refuses to run unless DATABASE_URL points at localhost.
//
//   owner@tacticoach.test  role owner  → /admin (blog, CRM, book review queue)
//   club@tacticoach.test   Club 10, active for a year, owns "Riverside FC"
//   coach@tacticoach.test  Pro, active for a year, a solo coach
//
// Safe to re-run: accounts are updated in place, never duplicated.

import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'

const url = process.env.DATABASE_URL ?? ''
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('Refusing: DATABASE_URL does not point at localhost. These are test accounts for a local database only.')
  process.exit(1)
}

const db = new PrismaClient({ adapter: new PrismaMariaDb(url) })

/** 14 characters, letters and digits, always at least one of each kind. */
function password(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(14)
  const body = Array.from(bytes, (b) => chars[b % chars.length]).join('')
  return `${body.slice(0, 11)}A7z`
}

interface Spec {
  email: string
  name: string
  surname: string
  role: 'owner' | 'user'
  accountType: 'coach' | 'club'
  plan: string | null
  clubName?: string
}

const ACCOUNTS: Spec[] = [
  { email: 'owner@tacticoach.test', name: 'Olivia', surname: 'Owner', role: 'owner', accountType: 'coach', plan: 'pro' },
  { email: 'club@tacticoach.test', name: 'Carlos', surname: 'Club', role: 'user', accountType: 'club', plan: 'club-10', clubName: 'Riverside FC' },
  { email: 'coach@tacticoach.test', name: 'Chris', surname: 'Coach', role: 'user', accountType: 'coach', plan: 'pro' },
]

async function main() {
  const inAYear = new Date(Date.now() + 365 * 86_400_000)
  const printed: { email: string; password: string; what: string }[] = []

  // DEV_PASSWORD=… sets one password you choose for all three; otherwise each
  // gets a fresh random one.
  const chosen = process.env.DEV_PASSWORD?.trim()
  if (chosen !== undefined && chosen.length < 8) {
    console.error('DEV_PASSWORD must be at least 8 characters.')
    process.exit(1)
  }

  for (const a of ACCOUNTS) {
    const pw = chosen || password()
    const passwordHash = await bcrypt.hash(pw, 12)
    const user = await db.user.upsert({
      where: { email: a.email },
      update: { passwordHash, role: a.role, accountType: a.accountType, emailVerifiedAt: new Date(), clubName: a.clubName ?? null },
      create: {
        email: a.email, name: a.name, surname: a.surname, passwordHash,
        role: a.role, accountType: a.accountType, emailVerifiedAt: new Date(), clubName: a.clubName ?? null,
      },
      select: { id: true },
    })

    let what = a.role === 'owner' ? 'owner (/admin)' : a.accountType
    if (a.plan) {
      const plan = await db.membershipPlan.findUnique({ where: { slug: a.plan }, select: { id: true, name: true } })
      if (!plan) {
        console.warn(`⚠️  Plan "${a.plan}" is not seeded. Run: npx tsx prisma/seed.ts, then this script again.`)
      } else {
        await db.userSubscription.upsert({
          where: { userId: user.id },
          update: { planId: plan.id, status: 'active', billingCycle: 'annual', expiresAt: inAYear, cancelledAt: null },
          create: { userId: user.id, planId: plan.id, status: 'active', billingCycle: 'annual', expiresAt: inAYear },
        })
        what += ` · ${plan.name}, active until ${inAYear.toISOString().slice(0, 10)}`
      }
    }

    // A club plan owner owns a Club row — the same thing a real Club purchase
    // creates (membership.service activateSubscription).
    if (a.clubName) {
      await db.club.upsert({
        where: { ownerId: user.id },
        update: { name: a.clubName },
        create: { ownerId: user.id, name: a.clubName },
      })
      what += ` · owns "${a.clubName}"`
    }

    printed.push({ email: a.email, password: pw, what })
  }

  console.log('\nLocal test accounts (new passwords every run — shown once):\n')
  for (const p of printed) console.log(`  ${p.email.padEnd(24)} ${p.password}   ${p.what}`)
  console.log('\nSign in at http://localhost:5280/login. These addresses cannot receive email (.test).\n')
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => db.$disconnect())
