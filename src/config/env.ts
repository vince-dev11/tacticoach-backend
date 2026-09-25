import { z } from 'zod'
import 'dotenv/config'

/**
 * A boolean from an environment variable.
 *
 * NOT `z.coerce.boolean()`, which is `Boolean(value)` — and every non-empty
 * string is truthy, so `SMTP_SECURE=false` parsed as TRUE. nodemailer would
 * then open a TLS socket to port 587, which expects plaintext then STARTTLS,
 * and the first password-reset email of the day would hang until it timed out.
 *
 * Only the words below are true. Anything else — including a typo — is false,
 * because the failure modes are not symmetric: `secure: false` on a 465 port
 * fails loudly at connect time, while `secure: true` on 587 hangs.
 */
export const envBool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())))

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().min(1),

  // 32 chars minimum: a signing key short enough to brute-force offline makes
  // every other auth control decorative. The two must also differ — sharing
  // one key between short-lived access tokens and 30-day refresh tokens means
  // a single leak compromises both.
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // S3 is optional for local development. Upload routes return 503 until it
  // is configured, but the server itself can boot without these values.
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),

  CORS_ORIGINS: z.string().default('http://localhost:5280'),

  // Local-disk upload fallback (used automatically when S3 is unconfigured).
  UPLOADS_DIR: z.string().optional(),
  // Absolute base URL the API is reachable at (for local /uploads links).
  PUBLIC_API_URL: z.string().optional(),

  // Stripe — optional so the API still boots without billing configured;
  // billing routes return 503 until both are set.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Frontend base URL for checkout redirects, club invites and reset links —
  // and every absolute URL inside an EMAIL, including the logo. The localhost
  // default is a development convenience that must never survive into
  // production; see the boot check below.
  FRONTEND_URL: z.string().default('http://localhost:5280'),

  // SMTP — optional so the API still boots without email configured. Password
  // reset emails are only sent when SMTP_HOST + SMTP_USER + SMTP_PASS are set
  // (works with Gmail, Resend, SendGrid, SES, Postmark — anything SMTP).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // true for port 465 (TLS from the first byte), false for 587 (STARTTLS).
  SMTP_SECURE: envBool(false),
  MAIL_FROM: z.string().default('TactiCoach <no-reply@tacticoach.co.uk>'),
  // Where contact-form submissions are delivered. Defaults to MAIL_FROM.
  SUPPORT_EMAIL: z.string().optional(),

  // The account with this email is promoted to the 'owner' role at boot and
  // on registration — it unlocks the /admin area (blog CMS + CRM).
  OWNER_EMAIL: z.string().optional(),

  // Gemini — optional so the API still boots without AI configured; the AI
  // tactics routes return 503 until GEMINI_API_KEY is set.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  // Alternative AI provider: any OpenAI-compatible endpoint (NVIDIA NIM,
  // OpenAI, Groq, …). When AI_PROVIDER=openai-compat these three are used
  // instead of Gemini.
  AI_PROVIDER: z.enum(['gemini', 'openai-compat']).default('gemini'),
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),

  // Error tracking (Sentry) — optional; read directly by src/instrument.ts,
  // declared here so they are documented and type-checked in one place.
  // Nothing is reported unless SENTRY_DSN is set.
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.string().optional(),
  SENTRY_SERVER_NAME: z.string().optional(),

  // Admin → Analytics: read-only access to the analytics tools, so the owner
  // sees countries, feature usage, funnels and health inside the admin panel.
  // Each source is optional; the page says "not connected" for any that is
  // missing. See TACTICAL_COACH/Admin_Analytics_Setup.md.
  GA4_PROPERTY_ID: z.string().optional(),
  // The service-account key: the JSON itself, or a path to the .json file.
  GA4_SERVICE_ACCOUNT_JSON: z.string().optional(),
  POSTHOG_HOST: z.string().optional(),
  POSTHOG_PROJECT_ID: z.string().optional(),
  POSTHOG_PERSONAL_API_KEY: z.string().optional(),
  SENTRY_API_URL: z.string().optional(),
  SENTRY_API_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT_API: z.string().optional(),
  SENTRY_PROJECT_WEB: z.string().optional(),
  // PageSpeed Insights (Admin → Analytics → Health). Works without a key at
  // low volume; a key raises the quota. URL defaults to FRONTEND_URL.
  PAGESPEED_API_KEY: z.string().optional(),
  PAGESPEED_URL: z.string().optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌  Invalid environment variables:')
  for (const [key, issues] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`   ${key}: ${issues?.join(', ')}`)
  }
  process.exit(1)
}

// Refuse to boot with the two JWT keys set to the same value — the whole point
// of separate access/refresh secrets is that they fail independently.
if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
  console.error('❌  JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.')
  console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"')
  process.exit(1)
}

/** Hostnames that mean "this is a developer's machine, not a real site". */
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * A production server must never mail localhost links.
 *
 * FRONTEND_URL is the base for every absolute URL in an email: the
 * set-password button, the reset link, the club invite, the guardian view and
 * the logo in the header. Left unset, the default quietly sent real coaches a
 * `http://localhost:5280/reset-password?token=…` they could not use and a logo
 * that rendered as a broken image — nothing failed, nothing logged, and the
 * only way to find out was for someone to open the mail.
 *
 * So it is checked at boot, where it is loud and cheap, instead of at send
 * time, where it is invisible.
 */
if (parsed.data.NODE_ENV === 'production') {
  let host = ''
  try {
    host = new URL(parsed.data.FRONTEND_URL).hostname
  } catch {
    console.error(`❌  FRONTEND_URL is not a valid URL: ${parsed.data.FRONTEND_URL}`)
    process.exit(1)
  }
  if (LOCALHOST_HOSTNAMES.has(host)) {
    console.error(`❌  FRONTEND_URL is ${parsed.data.FRONTEND_URL} in production.`)
    console.error('   Every link and image in every email would point at localhost.')
    console.error('   Set it in .env, e.g. FRONTEND_URL=https://app.tacticoach.co.uk')
    process.exit(1)
  }
}

export const env = parsed.data

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean)


export function isAllowedCorsOrigin(origin: string | undefined) {
  if (!origin) {
    return true
  }

  if (corsOrigins.includes(origin)) {
    return true
  }

  if (env.NODE_ENV !== 'production') {
    try {
      const parsedOrigin = new URL(origin)
      return LOCALHOST_HOSTNAMES.has(parsedOrigin.hostname)
    } catch {
      return false
    }
  }

  return false
}
