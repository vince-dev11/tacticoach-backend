#!/usr/bin/env bash
#
# Recover a half-applied migration 17, in the right order.
#
#   bash scripts/recover-migration-17.sh
#
# THE ORDER IS THE WHOLE POINT. Three things have to happen and each one is
# useless without the others:
#
#   1. DROP what migration 17 half-created. Otherwise it fails again on the
#      same "Duplicate column name `referral_code`".
#   2. TELL PRISMA the failure was undone (`migrate resolve --rolled-back`).
#      Until you do, `migrate deploy` answers P3009 and does nothing at all —
#      it will not even look at the other migrations.
#   3. THEN deploy.
#
# Running 3 on its own gets P3009. Running 2 then 3 without 1 gets the
# duplicate column again. This script exists because that is two ways to lose
# ten minutes, and they both look like the migration being broken.
#
# It is SAFE ON A DEVELOPMENT DATABASE where the referral and collaboration
# features have never been used. It drops tables. Read what it prints before
# answering yes.

set -euo pipefail
cd "$(dirname "$0")/.."

MIGRATION=17_referrals_collaborations

# ---- Connection details, from .env rather than typed in ---------------------
# A password on a command line lands in your shell history and in `ps`. Parsed
# out of DATABASE_URL so it does neither.
if [[ ! -f .env ]]; then
  echo "No .env here. Run this from the tacticoach-api directory." >&2
  exit 1
fi

DB_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"'"'")
if [[ -z "${DB_URL}" ]]; then
  echo "No DATABASE_URL in .env." >&2
  exit 1
fi

# mysql://user:pass@host:port/database
proto_removed=${DB_URL#*://}
# Split on the LAST @, not the first: database passwords contain @ more often
# than hostnames do, and %%@* / #*@ would cut the password in half and then
# fail to connect with a message about the host.
credentials=${proto_removed%@*}
hostpart=${proto_removed##*@}
DB_USER=${credentials%%:*}
DB_PASS=${credentials#*:}
DB_HOST=${hostpart%%:*}
rest=${hostpart#*:}
DB_PORT=${rest%%/*}
DB_NAME=${rest#*/}
DB_NAME=${DB_NAME%%\?*}

run_sql() {
  MYSQL_PWD="${DB_PASS}" mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" "${DB_NAME}" "$@"
}

echo "Database: ${DB_NAME} on ${DB_HOST}:${DB_PORT} as ${DB_USER}"
echo

# ---- 0. Show them what is actually there ------------------------------------
echo "──── What the database has now ────────────────────────────────────────"
run_sql < scripts/diagnose-migration-17.sql
echo

cat <<'WARNING'
──── About to DROP ───────────────────────────────────────────────────────────
  referrals, referral_rewards, partners, partner_commissions,
  collaborators, collaborator_commissions, collaboration_applications,
  and users.referral_code

If any of those hold rows you care about — look at the counts above — answer
no and say so, and the reshape can be written as a migration instead.
WARNING

read -r -p "Drop them and re-run migration ${MIGRATION}? [y/N] " answer
if [[ ! "${answer}" =~ ^[Yy]$ ]]; then
  echo "Nothing changed."
  exit 0
fi

# ---- 1. Drop --------------------------------------------------------------
echo
echo "──── 1/5 Dropping ────────────────────────────────────────────────────"
run_sql < scripts/reset-migration-17.sql

# ---- 2. Clear the failed record -------------------------------------------
# Without this, `migrate deploy` answers P3009 and refuses to run ANY
# migration — not just this one.
echo
echo "──── 2/5 Clearing the failed migration record ────────────────────────"
npx prisma migrate resolve --rolled-back "${MIGRATION}"

# ---- 3. Deploy -------------------------------------------------------------
echo
echo "──── 3/5 Applying migrations ─────────────────────────────────────────"
npx prisma migrate deploy

# ---- 4. Regenerate ---------------------------------------------------------
# After this, tests/referrals-shim.test.ts and tests/collaborations-shim.test.ts
# fail ON PURPOSE and tell you which files to delete.
echo
echo "──── 4/5 Regenerating the client ─────────────────────────────────────"
npx prisma generate

# ---- 5. Seed ---------------------------------------------------------------
# Not optional: without it the club annual prices stay at £249/£399/£699 and a
# club referring a club costs 10.04%, quietly over the cap.
echo
echo "──── 5/5 Seeding plans ───────────────────────────────────────────────"
npx tsx prisma/seed.ts

cat <<'DONE'

Done.

Next: `npm test`. Two tests are EXPECTED to fail now that the Prisma client has
caught up — they are the self-deleting reminders for the two TEMPORARY shims,
and each one prints the list of files to delete.
DONE
