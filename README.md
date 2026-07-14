# TactiCoach API

TactiCoach backend API — **Fastify + Prisma + MySQL/MariaDB** (TypeScript, ESM).

REST routes under `/api/*`: auth, users, membership, canvas, clubs, drill-sheets, and Stripe webhooks, with JWT auth, S3 uploads, and Stripe billing.

## Requirements

- Node.js 18+ (ESM)
- MySQL or MariaDB server
- (Optional) AWS S3 bucket + credentials for uploads
- (Optional) Stripe keys for billing

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Fill in DATABASE_URL and JWT secrets.
# Add AWS/S3 values only if you want uploads and presigned media URLs.
# Generate JWT secrets with:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 3. Prepare the database
npm run db:generate   # generate the Prisma client
npm run db:push       # create tables from prisma/schema.prisma
npm run db:seed       # optional: seed membership plans

# 4. Run
npm run dev           # dev server with hot reload → http://localhost:3001
```

Health check: `curl http://localhost:3001/health` → `{"status":"ok",...}`

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Dev server with watch (tsx) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run db:migrate` | `prisma migrate dev` (versioned migrations) |
| `npm run db:push` | Sync schema without migration files |
| `npm run db:seed` | Seed the database |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:generate` | Regenerate the Prisma client |

## Environment variables

See [.env.example](.env.example). Required: `DATABASE_URL`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`. AWS/S3 variables are optional for local development:
upload routes return `503` until they are configured, but the server will boot
without them. Stripe keys are optional — billing routes return `503` until they are set.
