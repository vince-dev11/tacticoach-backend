import { env } from './config/env.js'
import { db } from './config/database.js'
import { buildApp } from './app.js'
import { startTrialReminderScheduler } from './jobs/trial-reminders.js'

const start = async () => {
  const app = await buildApp()
  try {
    await db.$connect()
    // Promote the configured owner account (idempotent; covers accounts that
    // existed before OWNER_EMAIL was set).
    if (env.OWNER_EMAIL) {
      await db.user.updateMany({
        where: { email: env.OWNER_EMAIL, role: { not: 'owner' } },
        data: { role: 'owner' },
      })
    }
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
    startTrialReminderScheduler()
    console.log(`🚀  TactiCoach API running on port ${env.PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
