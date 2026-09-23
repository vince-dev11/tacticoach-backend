# Deploy runbook — referrals + collaboration release

**Both repos, in order.** `DEPLOYMENT.md` describes the *containerised* setup
this project ships Dockerfiles for. **Production does not use it.** What is
actually running is below, and it is what this file assumes.

---

## How this server actually works

Checked against `Deploy_2026-09-17.md` and `DEPLOY_2026-09-17-player.md`, the
two previous production deploys.

| | |
|---|---|
| Host | `ubuntu@13.53.60.120` |
| API | `/var/www/html/tacticoach-backend`, run by **pm2** as `tacticoach-api` |
| Frontend | `/var/www/html/tacticoach-frontend` — **nginx serves `dist/`**, no process |
| Database | MySQL 8.0 **on the box**, database `tacticoach`; the app user comes from `.env`; root is `sudo mysql` (socket auth, no password) |
| Docker | **not installed** |

pm2 is running `node dist/index.js` against the build already on disk.
`npx prisma migrate deploy` is a separate command you type. **If it fails, the
site stays up on the old code.** The one thing not to do after a failure:

> **If `migrate deploy` fails, do NOT run `pm2 restart`.**

Old code + old schema is fine. New code + half-migrated schema is the outage.

---

## What happened on 22 September, and what this release does instead

The first attempt failed with `P3018 — Duplicate column name 'referral_code'`
on migration `17_referrals_collaborations`. `migrate status` then showed why:

```
The last common migration is: 16_coach_branding
The migration from the database are not found locally: 17_referrals_partners
```

Production had applied migration 17 **under its original name** on
17 September. For this release it was renamed and rewritten in place — which
to Prisma is a brand-new migration trying to CREATE tables that already
exist. It failed on its first statement, so it changed nothing, and it made
the rule plain: **an applied migration is history, and history is not
edited.**

So this release now ships:

- `17_referrals_partners` — **restored byte-for-byte**. Already applied in
  production; `migrate deploy` skips it.
- `25_partners_to_collaborators` — **new**. The rename and reshape as a
  forward step: `partners` → `collaborators`, one rate → two, referral
  tiers → plan slugs. **Every row survives.** Numbered 25 because 32 alters
  `collaborators`, so the rename has to land first, and the 25 slot was
  empty everywhere.
- `26`–`32` — unchanged (32's index name corrected to Prisma's convention).
- `33_align_with_schema` — **new**: the exact SQL `prisma migrate diff`
  emitted against the rehearsal copy — nine index renames and five dropped
  `updated_at` defaults left by hand-written migrations 22/26/28/30. No row
  changes. It exists so the drift check reads zero.

The three drop-and-retry scripts from the first attempt
(`reset-migration-17.sql`, `recover-migration-17.sh`,
`diagnose-migration-17.sql`) are **deleted**. They were written for a dev
database where the feature had never been used, and they drop tables.

---

## 0. Connect, set the paths, check the disk

```bash
ssh -i ~/Downloads/tacticoach.co.uk.pem ubuntu@13.53.60.120
```

```bash
export API_DIR=/var/www/html/tacticoach-backend
export WEB_DIR=/var/www/html/tacticoach-frontend
df -h /
```

`export` lasts only for that shell — reconnect and you run those lines again.

Disk was **82%, 1.3 GB free** on 22 September. This deploy runs `npm install`
twice, a Vite build, and creates a rehearsal copy of the database. Under
~1 GB free, clear space first: `npm cache clean --force`, and old
`~/*.sql.gz` you have already used (not today's).

---

## 1. Preflight — read-only

```bash
cd "$API_DIR"
git pull
bash scripts/preflight-deploy.sh
npx prisma migrate status
```

| Preflight section | Expect | Otherwise |
|---|---|---|
| **1. Starting point** | `EXPECTED: 17_referrals_partners applied, reshape not yet run` | Stop. Paste sections 1, 3, 4. |
| **2. Rows to carry across** | whatever they are — **write them down** | — |
| **3. Failed migrations** | `0` | `npx prisma migrate resolve --rolled-back NAME` first |
| **5. Club prices** | `RE-SEED NEEDED` | expected; step 5 |

`migrate status` should list **25 through 33** as not yet
applied and nothing under "not found locally". If it still mentions
`17_referrals_collaborations`, that record was not rolled back — section 3
above says how.

---

## 2. Back up

```bash
cd "$API_DIR"
bash scripts/backup-db.sh
```

Writes `~/tacticoach-backup-YYYY-MM-DD-HHMM.sql.gz`, then **reads it back**:
gzip integrity, table count, and mysqldump's `Dump completed` marker. A
half-written file that exists is the failure you discover at the moment you
need it. Prisma migrations have no `down`; this file is the rollback.

(If you already took `~/tacticoach-2026-09-22-pre-collab.sql.gz` by hand, that
is the same thing. Either is fine; use the newest in step 7.)

---

## 3. Rehearse on a copy — this is the step that matters

Exactly what the 17 September deploy did for migration 22, because the
reshape rewrites rows rather than just adding columns. Five minutes, and the
only way to see it work on real data before it counts.

```bash
cd "$API_DIR"
bash scripts/make-rehearsal-db.sh      # copies the newest backup into tacticoach_rehearsal
bash scripts/verify-migrations.sh
```

`make-rehearsal-db.sh` uses `sudo mysql` — root authenticates over the socket
on this box, so there is no root password to know — creates the database,
grants the `.env` user on it at every host that user exists for, and restores
the newest `~/tacticoach-backup-*.sql.gz`. It refuses to overwrite an
existing rehearsal.

The script runs the pending migrations **against the copy**, then:

1. Compares row counts before and after — partners → collaborators,
   commissions, referrals, rewards, users with a code. **Must all match.**
2. Prints the rate mapping for any existing partner (their one agreed rate is
   copied to both `coach_rate` and `club_rate` — the only mapping that cannot
   pay them less than they signed for).
3. Runs `prisma migrate diff` from the migrated copy to `schema.prisma` with
   `--exit-code`. **Exit 0 — identical — is the only pass.** Drift prints the
   SQL that would still be needed.

It ends with `PASSED` or it tells you why not. **Anything other than `PASSED`:
stop, paste the output, do not touch the live database.**

Drop the copy when you are happy (or keep it until after step 4 — it is a
second safety net):

```bash
sudo mysql -e "DROP DATABASE tacticoach_rehearsal"
```

---

## 4. Deploy the API

```bash
cd "$API_DIR"
npm install --omit=dev
npx prisma generate
npx prisma migrate deploy
```

**Read the output before going on.** Nine migrations should apply: 25
through 33. If anything fails, the site is still up on the old code — stop
here, do not restart, paste the error.

Then the same carry-across check the rehearsal did, on the live database:

```bash
bash -c 'source scripts/db-env.sh && run_sql --table -e "SELECT (SELECT COUNT(*) FROM collaborators) AS collaborators, (SELECT COUNT(*) FROM collaborator_commissions) AS commissions, (SELECT COUNT(*) FROM referrals) AS referrals, (SELECT COUNT(*) FROM referral_rewards) AS rewards, (SELECT COUNT(*) FROM users WHERE referral_code IS NOT NULL) AS users_with_code"'
```

Those must equal preflight section 2. Only then:

```bash
npm run build && pm2 restart tacticoach-api
pm2 logs tacticoach-api --lines 40
```

**The `&&` is load-bearing.** On 23 September `npm run build` failed on two
type errors (`@types/pdfkit` was a devDependency and `--omit=dev` had skipped
it) and the restart ran anyway. It worked only because `tsc` still emits on
type errors — the JS was fine, the declarations were missing. With `&&` a
failed build never restarts anything, and the old build keeps serving until
you have looked. Type packages the build needs are now in `dependencies`.

---

## 5. Re-seed the plans — not optional

```bash
cd "$API_DIR"
npx --yes tsx prisma/seed.ts
```

**`npx --yes tsx`, not `npm run db:seed`** — `tsx` is a devDependency and
`--omit=dev` skipped it; the npm script fails with `spawn tsx ENOENT`. This
bit the 17 September deploy.

Without the seed, club annual prices stay at £249 / £399 / £699 and a club
referring a club costs **10.04%** — over the cap the referral programme is
built on. Verify:

```bash
bash -c 'source scripts/db-env.sh && run_sql --table -e "SELECT slug, monthly_price, annual_price FROM membership_plans WHERE slug LIKE '"'"'club-%'"'"' ORDER BY slug"'
```

Expect **250 / 400 / 700**.

---

## 6. Deploy the frontend

`VITE_API_URL` is compiled **into the bundle at build time**. The build runs
on the box, so it comes from `$WEB_DIR/.env` — not a build argument.

```bash
cd "$WEB_DIR"
cat .env          # VITE_API_URL must be https://api.tacticoach.co.uk, NOT localhost
git pull
npm install       # NOT --omit=dev: vite and tsc are devDependencies
npm run build
```

nginx serves `dist/` directly — **no restart, no pm2**.

---

## 7. Rollback

**Frontend** — code and bundle go back together:

```bash
cd "$WEB_DIR"
git log --oneline -5
git checkout THAT_COMMIT
npm install && npm run build
```

**API** — code and database go back together:

```bash
cd "$API_DIR"
git log --oneline -5
git checkout THAT_COMMIT
npm install --omit=dev && npx prisma generate && npm run build
ls -lh ~/tacticoach-backup-*.sql.gz ~/tacticoach-2026-09-22-*.sql.gz
bash -c 'source scripts/db-env.sh && gunzip < ~/THE-ONE-FROM-TODAY.sql.gz | run_sql'
pm2 restart tacticoach-api
```

Code back *without* the database leaves the old code reading `partners`,
which no longer exists. It starts, and fails on the first referral query.

> `tacticoach-2026-09-15-1644.sql.gz` and `tacticoach-2026-09-17-pre22.sql.gz`
> in `~` predate this release. Restoring either would also unwind migrations
> 22–24. **Use today's.**

---

## 8. Smoke test

1. `curl https://api.tacticoach.co.uk/health` → `{"status":"ok"}`
2. **`/collaborate`** loads and the form submits — the row lands in
   `collaboration_applications`.
3. **`/collaborators`** loads (empty state is correct).
4. **`/referrals`** shows the grid; the landing page's **Earn with us**
   section links to both.
5. Sign in → Profile → the referral section asks you to **sign the terms**.
6. Admin → **Referrals** shows the signature list; Admin → **Collaborations**
   shows the roster — **including anyone who was a partner before**, with
   the same rate they had.
7. `pm2 logs tacticoach-api --lines 40` — no repeated errors.

---

## Known issues this deploy does NOT fix

- **S3 is broken.** `AWS_ACCESS_KEY_ID=placeholder`. Every upload fails with
  `InvalidAccessKeyId`. Real keys go **on the server only** — never in chat,
  never committed.
- **The Gmail app password was pasted into a chat** (17 September). Revoke,
  regenerate, type it straight into the server's `.env`.
- **The `.pem` was shared in a chat.** Regenerate the key pair.
- **Disk at 82%.**
- **Nobody is emailed on ebook submit / approve / reject.**
- **Collaborator payouts are manual.** No job for 1 Feb / 1 Jun / 1 Oct, no
  content-link submission. First payout is 1 February.
- **Six older TEMPORARY Prisma shims** (migrations 22, 23, 24, 26, 28, 30)
  are inert and should be cleared in a separate change.
