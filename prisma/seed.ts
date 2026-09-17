import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import 'dotenv/config'

// Prisma 7's "client" engine needs an explicit driver adapter (same as src/config/database.ts).
const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
const db = new PrismaClient({ adapter })

async function main() {
  // Membership plans — matched to the pricing shown on the landing page.
  // Annual price = per-month price billed yearly (12×).
  // LAUNCH: AI is feature-flagged off, so plan copy carries no AI promises and
  // the Pro + AI tier is kept but INACTIVE (re-activate + restore AI copy when
  // the AI relaunch ships).
  const plans = [
    {
      name: 'Pro',
      slug: 'pro',
      description: 'The full platform for hands-on coaches.',
      monthlyPrice: '2.99',
      annualPrice: '29.99', // 2 months free (≈ £2.50/mo billed yearly)
      currency: 'GBP',
      features: ['All pitch types', 'Unlimited tactics', 'Animation timeline', 'HD video export', 'Cloud sync', 'Drill sheet export'],
      maxBoards: null,
      maxTeamMembers: 1,
      isActive: true,
      sortOrder: 1,
    },
    {
      name: 'Pro + AI',
      slug: 'pro-ai',
      description: 'Everything in Pro plus AI tactic generation.',
      monthlyPrice: '5.99',
      annualPrice: '59.99', // 2 months free (≈ £5.00/mo billed yearly)
      currency: 'GBP',
      features: ['Everything in Pro', '30 AI credits / month', 'AI coaching notes', 'Drill suggestions', 'Auto-animation'],
      maxBoards: null,
      maxTeamMembers: 1,
      isActive: false, // hidden until the AI relaunch
      sortOrder: 2,
    },
    {
      name: 'Club',
      slug: 'club',
      description: 'For coaching teams. Up to 10 coach seats.',
      monthlyPrice: '24.99',
      annualPrice: '249.00', // 2 months free (≈ £20.75/mo billed yearly)
      currency: 'GBP',
      features: ['Everything in Pro', '10 coach seats', 'Shared tactic library', 'Club branding page', 'Session builder', 'Priority support'],
      maxBoards: null,
      maxTeamMembers: 10,
      isActive: true,
      sortOrder: 3,
    },
    {
      // RETIRED. Players are free and always will be — see the comment on
      // playerAccess in lib/entitlements.
      //
      // Why it was wrong to sell: a player's value is produced by their coach.
      // Charging the player for words somebody else has to write puts a paywall
      // between us and the only organic distribution we have — every connected
      // player is a coach-shaped hole at their next club. It also made the
      // cheapest plan the most expensive to serve: ~22% of £2.99 goes in card
      // fees, against ~8% on an annual coach plan, and players outnumber
      // coaches roughly 20:1.
      //
      // Kept as a row rather than deleted. Anyone who did subscribe keeps a
      // valid plan relation and runs to the end of what they paid for;
      // isActive:false is enough to close the sale, because GET /plans filters
      // on it and POST /membership/checkout refuses an inactive plan. Deleting
      // the row would orphan those subscriptions.
      //
      // The upsert below writes isActive on EXISTING rows too, so re-seeding
      // production is what actually retires it.
      name: 'Player',
      slug: 'player',
      description: 'Retired — players are free. Kept so historic subscriptions still resolve.',
      // Left at what it actually cost. A historic subscriber's billing screen
      // reads its price from this row, and showing them £0.00 for something
      // Stripe is still charging them £2.99 for would be a lie.
      monthlyPrice: '2.99',
      annualPrice: '29.00',
      currency: 'GBP',
      features: [],
      maxBoards: 0,
      maxTeamMembers: 0,
      isActive: false,
      sortOrder: 4,
    },
  ]

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
