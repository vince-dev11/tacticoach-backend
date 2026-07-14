# TactiCoach — Deployment Guide

Two deployables: **tacticoach-api** (Fastify + Prisma + MySQL) and
**tacticoach-frontend** (static Vite bundle). Both ship Dockerfiles; any
platform that runs containers or Node 22 + static hosting works.

## 1. Environment variables (API)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | `mysql://user:pass@host:3306/tacticoach` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | ✅ | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` | ✅ | Media storage (thumbnails, videos, logos, sheet images) |
| `CORS_ORIGINS` | ✅ | Comma-separated, e.g. `https://tacticoach.co.uk` |
| `FRONTEND_URL` | ✅ | Base URL used in emails + Stripe redirects |
| `PORT` | – | Defaults to 3001 |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ○ | Billing routes return 503 until set |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` | ○ | All transactional email (welcome/verify, trial reminders, purchase, invites, reset, contact) is skipped until set |
| `SUPPORT_EMAIL` | ○ | Contact-form inbox (defaults to `MAIL_FROM`) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | ○ | AI tactics routes return 503 until set (model defaults to `gemini-2.5-flash`) |
| `OWNER_EMAIL` | ○ | The account with this email becomes the company owner — unlocks `/admin` (blog CMS + CRM) |

○ = optional: the API boots and degrades gracefully without it, but for a real
launch you want Stripe, SMTP and Gemini all configured.

Frontend build-time variable: `VITE_API_URL` (the API's public URL).

## 2. Database

Migrations live in `prisma/migrations` (baseline: `0_init`).

- **Fresh database:** `npx prisma migrate deploy` (the API Dockerfile runs this
  automatically on start), then seed the plans: `npx prisma db seed`.
- **Applying new migrations to an existing DB:** `npx prisma migrate deploy` (the
  `1_admin_blog_crm` migration adds the owner role, blog posts and CRM leads).
- **Existing database created with `db push`:** sync drift once, mark the
  baseline as applied, and use `migrate deploy` from then on:

  ```bash
  npx prisma db push                          # adds trial_reminder_sent_at etc.
  npx prisma migrate resolve --applied 0_init
  ```

## 3. Stripe

1. Set `STRIPE_SECRET_KEY` (live key) and deploy.
2. In the Stripe dashboard add a webhook endpoint:
   `https://api.<domain>/api/webhooks/stripe` with events
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
3. Put the webhook signing secret in `STRIPE_WEBHOOK_SECRET`.

Prices come from the `membership_plans` table (inline `price_data`), so no
product setup in Stripe is needed. Edit prices via the seed or directly in DB.

## 4. S3

Create a private bucket (no public access). The API uploads with server-side
keys and hands out short-lived presigned URLs, so no bucket policy or CORS
rules for downloads are required.

## 5. Run it

```bash
# API + MySQL
cd tacticoach-api
cp .env.example .env   # fill it in
docker compose up --build -d
docker compose exec api npx prisma db seed   # first run only

# Frontend
cd ../tacticoach-frontend
docker build --build-arg VITE_API_URL=https://api.<domain> -t tacticoach-frontend .
docker run -d -p 8080:80 tacticoach-frontend
```

Put a TLS-terminating proxy (Caddy, nginx, a load balancer, Cloudflare) in
front of both. The frontend container already handles SPA route fallback.

## 6. Post-deploy smoke test

1. `GET https://api.<domain>/health` → `{ "status": "ok" }`
2. Sign up → welcome email arrives, link verifies at `/verify-email`.
3. Save a board in the editor; check the thumbnail appears in the Library.
4. Test checkout with a Stripe test card → plan activates, purchase email arrives.
5. Club plan: invite a coach → email arrives → seat claim at `/club/join/…`.

## 7. Scaling note

The trial-reminder scheduler runs inside the API process and claims rows
atomically, so running multiple API replicas will not double-send emails —
but if you scale horizontally, consider moving the sweep to a single cron
runner (`sweepTrialReminders()` in `src/jobs/trial-reminders.ts` is directly
invokable) to avoid redundant queries.
