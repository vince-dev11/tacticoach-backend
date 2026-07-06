import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import 'dotenv/config'

// Prisma 7's "client" engine needs an explicit driver adapter (same as src/config/database.ts).
const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
const db = new PrismaClient({ adapter })

async function main() {
  // Membership plans — matched to the pricing shown on the landing page.
  // Annual price = per-month price billed yearly (12×).
  const plans = [
    {
      name: 'Pro',
      slug: 'pro',
      description: 'Full platform, no AI. Perfect for manual coaches.',
      monthlyPrice: '2.99',
      annualPrice: '23.88', // £1.99/mo billed yearly
      currency: 'GBP',
      features: ['All pitch types', 'Unlimited tactics', 'Animation timeline', 'HD video export', 'Cloud sync'],
      maxBoards: null,
      maxTeamMembers: 1,
      sortOrder: 1,
    },
    {
      name: 'Pro + AI',
      slug: 'pro-ai',
      description: 'Everything in Pro plus AI tactic generation.',
      monthlyPrice: '5.99',
      annualPrice: '47.88', // £3.99/mo billed yearly
      currency: 'GBP',
      features: ['Everything in Pro', '5 AI credits / month', 'AI coaching notes', 'Drill suggestions', 'Auto-animation'],
      maxBoards: null,
      maxTeamMembers: 1,
      sortOrder: 2,
    },
    {
      name: 'Club',
      slug: 'club',
      description: 'For coaching teams. Up to 10 coach seats.',
      monthlyPrice: '14.99',
      annualPrice: '119.88', // £9.99/mo billed yearly
      currency: 'GBP',
      features: ['Everything in Pro + AI', '20 AI credits / month', '10 coach seats', 'Shared tactic library', 'Priority support'],
      maxBoards: null,
      maxTeamMembers: 10,
      sortOrder: 3,
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
      },
      create: plan,
    })
  }

  console.log('✅  Seeded membership plans')
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
