import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { env } from './env.js'

// Prisma 7's "client" engine needs an explicit driver adapter.
const adapter = new PrismaMariaDb(env.DATABASE_URL)

export const db = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
})
