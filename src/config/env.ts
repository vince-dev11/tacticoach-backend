import { z } from 'zod'
import 'dotenv/config'

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),

  CORS_ORIGINS: z.string().default('http://localhost:5280'),

  // Stripe — optional so the API still boots without billing configured;
  // billing routes return 503 until both are set.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Frontend base URL for checkout redirects and club invite links.
  FRONTEND_URL: z.string().default('http://localhost:5280'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌  Invalid environment variables:')
  for (const [key, issues] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`   ${key}: ${issues?.join(', ')}`)
  }
  process.exit(1)
}

export const env = parsed.data
export const corsOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim())
