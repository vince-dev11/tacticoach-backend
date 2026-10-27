# TactiCoach — working rules (API)

Fastify + Prisma (MySQL) API behind `api.tacticoach.co.uk`, serving the app at `tacticoach.co.uk`. Serves the coaching product: auth/accounts, canvas boards, drill sheets, sessions & season planner, player feedback, ebooks marketplace, clubs, referrals/collaboration, admin, and the coach context for the future AI (`src/lib/coachContext.ts`; the old AI module was removed 27 Oct 2026 — the new design is `docs/ai/`). The frontend repo's `CLAUDE.md` and `.claude/skills/` hold the product and football knowledge; the same skills are mirrored here.

## Rules

- The API is the real enforcement. A UI guard is a courtesy; the request must be refused here too (`src/lib/player-lockdown.ts` for players, `requireOwner` for admin, ownership checks on every `:id`).
- Family accounts (12 Oct 2026, `src/modules/family`, `src/lib/age.ts`): register takes a player only with `dateOfBirth` + `confirmAge` (under 13 → 403 `under_13`; 13–17 needs `parent`, gets no tokens, and the parent is invited) and takes `parent` accounts; a coach can also create the player; a parent adds children (`POST /family/children`); a coach can ask through a parent's email (`squad_players.request_parent_id`); under 18 needs a parent's yes (`ParentLink`, consent recorded) before login works (`loginRefusal` on login and refresh); under 13 has `canLogin = false`; `isMinorAccount` (no date of birth counts as a minor) gates checkout (403 `ask_parent`) and becoming a coach. A coach never receives a player's set-password link.
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

`src/modules/<area>/{routes,service,schema}.ts`; `src/middleware/` (auth guard, error handler); `src/lib/` (emails, player lockdown, observability); `src/config/` (env, mailer, s3, database). Coach context (age group, format, level): `src/lib/coachContext.ts`. The Ask help assistant: `src/modules/assistant` (uses `src/config/gemini.ts`).

## Docs

`docs/deploy/` (deploy notes and runbook: write a new one per release), `docs/setup/` (Stripe and email, analytics, error tracing, hosting), `docs/ai/` (editor AI plan), `docs/briefs/`, `docs/planning/`. Feature briefs, reviews and the glossary are in the frontend repo's `docs/`. No keys, passwords or customer data in any doc.

## Definition of done

`.claude/skills/definition-of-done/SKILL.md`.
