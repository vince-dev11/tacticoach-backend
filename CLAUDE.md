# TactiCoach — working rules (API)

Fastify + Prisma (MySQL) API behind `api.tacticoach.co.uk`, serving the app at `tacticoach.co.uk`. Serves the coaching product: auth/accounts, canvas boards, drill sheets, sessions & season planner, player feedback, ebooks marketplace, clubs, referrals/collaboration, admin, and the football AI (`src/modules/ai`). The frontend repo's `CLAUDE.md` and `.claude/skills/` hold the product and football knowledge; the same skills are mirrored here.

## Rules

- The API is the real enforcement. A UI guard is a courtesy; the request must be refused here too (`src/lib/player-lockdown.ts` for players, `requireOwner` for admin, ownership checks on every `:id`).
- Every field error is a zod issue with a clear message; the error handler maps it to 422 `{ message, issues }`. Never leak stack traces or raw SQL.
- Rate limits: the production numbers (register 20/h, login per-account lock, contact 5/h, account routes 5–10/15 min, global 100/min) stay as they are; non-production is 50–100× looser so local end-to-end runs work. Keep that split when adding a limit.
- Money: pence integers in the database; book sales split 70/30 at payment time; players are free (the Player plan row is inactive, kept for history). Subscriptions: full refund on request within 14 days of the first payment, none after; a refund is made in Stripe (refund the charge, cancel the subscription now) and the webhooks expire access and reverse referral commission.
- Email: `MAIL_FROM` for automatic mail, `SUPPORT_EMAIL` as team inbox / Reply-To, `TEAM_MAIL_FROM` for mail written in Admin; contact-form mail replies to the sender.
- Migrations: numbered folders in `prisma/migrations`; early ones are not zero-padded, so a fresh local DB is built with `scripts/fresh-local-db.sh`, never `prisma migrate reset`. Production applies with `prisma migrate deploy`.
- Never commit secrets; `.env.example` documents every variable.

Before any change a coach could notice: `football-product-expert` (mandatory gate — level, brief before code, coach acceptance review after). Test what changed: map changed files to tests with `.claude/skills/qa-release/references/test-map.md`; the full suite only before a release, after a migration, or for a shared layer (middleware, entitlements, config).

Never: change a route's response shape without updating the frontend consumer and its mock in `tests/e2e`; add a Prisma field without a migration; widen a player-accessible route without a reason written in the comment.

After every change: `npm run typecheck`, `npx vitest run` on the area's tests from the test map (full suite is 73 files / ~1,370 tests — only per the rule above; sandbox needs `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`, and see `dev-environment` for `prisma generate`), tests named after the bug id for every fix.

## Map

`src/modules/<area>/{routes,service,schema}.ts`; `src/middleware/` (auth guard, error handler); `src/lib/` (emails, player lockdown, observability); `src/config/` (env, mailer, s3, database). AI: `ai.dsl.ts` (deterministic compiler: pattern + params → board objects/frames), `ai.concepts.ts` (concept cards, areas, principles), `ai.validate.ts` (squad size, age-appropriateness, layout, animation, brief), `ai.patterns.ts`, `evals/eval-ai.ts`.

## Definition of done

`.claude/skills/definition-of-done/SKILL.md`.
