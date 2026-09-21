import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import 'dotenv/config'
import { SEED_PLANS } from './plans.js'

// Prisma 7's "client" engine needs an explicit driver adapter (same as src/config/database.ts).
const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
const db = new PrismaClient({ adapter })

async function main() {
  // Membership plans — matched to the pricing shown on the landing page.
  // Annual price = per-month price billed yearly (12×).
  // LAUNCH: AI is feature-flagged off, so plan copy carries no AI promises and
  // the Pro + AI tier is kept but INACTIVE (re-activate + restore AI copy when
  // the AI relaunch ships).
  const plans = SEED_PLANS

  for (const plan of plans) {
    await db.membershipPlan.upsert({
      where: { slug: plan.slug },
      update: {
        monthlyPrice: plan.monthlyPrice,
        annualPrice: plan.annualPrice,
        currency: plan.currency,
        maxTeamMembers: plan.maxTeamMembers,
        // Launch state must reach existing rows too, not just fresh databases.
        description: plan.description,
        features: plan.features,
        isActive: plan.isActive,
      },
      create: plan,
    })
  }

  console.log('✅  Seeded membership plans')

  // Company admin (owner) account — unlocks /admin (blog CMS + CRM).
  // Email follows OWNER_EMAIL so the boot-time promotion agrees with the seed.
  // Default password is for LOCAL DEVELOPMENT — change it on any real server.
  const ownerEmail = process.env.OWNER_EMAIL ?? 'pvp12417@gmail.com'
  const ownerPassword = process.env.OWNER_SEED_PASSWORD ?? 'Admin@123'
  // Whether the account already existed decides what we may say afterwards:
  // the update branch deliberately does NOT touch passwordHash, so re-seeding
  // a live database never resets the owner's password.
  const ownerExisted = await db.user.findUnique({ where: { email: ownerEmail }, select: { id: true } })
  await db.user.upsert({
    where: { email: ownerEmail },
    update: { role: 'owner' },
    create: {
      name: 'Company',
      surname: 'Admin',
      email: ownerEmail,
      passwordHash: await bcrypt.hash(ownerPassword, 12),
      role: 'owner',
      emailVerifiedAt: new Date(),
    },
  })
  // Printing the default password when the account ALREADY existed said, in
  // effect, "your production admin password is now Admin@123" — into a
  // terminal, a pm2 log and whatever the operator pastes it into. It was never
  // true, and it is the kind of untrue that costs someone an hour of panic.
  console.log(
    ownerExisted
      ? `✅  Owner account already existed: ${ownerEmail} (role confirmed; password unchanged)`
      : `✅  Owner account created: ${ownerEmail}${
          process.env.OWNER_SEED_PASSWORD ? ' (password from OWNER_SEED_PASSWORD)' : ` (password: ${ownerPassword} — change it now)`
        }`,
  )

  // First weekly tactical challenge — so the Challenges page and Dashboard
  // widgets have real content the moment the app goes live, instead of an
  // empty state. Guarded on "no challenge currently running" so re-running
  // the seed against a live database never creates a duplicate week.
  const now = new Date()
  const hasActive = await db.challenge.findFirst({ where: { startsAt: { lte: now }, endsAt: { gte: now } } })
  if (!hasActive) {
    const startsAt = now
    const endsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    await db.challenge.create({
      data: {
        title: 'Break the low block',
        prompt:
          "Your 4-4-2 low block is under a wide overload. Show us how you'd shift and press without opening the middle.",
        tag: 'defending',
        startsAt,
        endsAt,
      },
    })
    console.log('✅  Seeded week 1 tactical challenge')
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
