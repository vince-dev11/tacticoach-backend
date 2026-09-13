import { env } from './config/env.js'
import { db } from './config/database.js'
import { describeStorage } from './config/s3.js'
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
    // Resolve (and create) upload storage before accepting traffic, so a bad
    // path fails here with the path in the message rather than on the first
    // coach who tries to save a video.
    const storage = describeStorage()

    await app.listen({ port: env.PORT, host: '0.0.0.0' })
    startTrialReminderScheduler()
    console.log(`🚀  TactiCoach API running on port ${env.PORT}`)
    console.log(`📦  Uploads: ${storage.backend === 's3' ? 'S3' : 'local disk'} → ${storage.location}`)
    if (storage.warning) console.warn(`⚠️   ${storage.warning}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
