#!/usr/bin/env bash
#
# Prove the migration chain, on a database that is not the real one.
#
#   bash scripts/verify-migrations.sh
#
# Runs `prisma migrate deploy` against <DB_NAME>_rehearsal and then asks
# Prisma the only question that matters: does the database those migrations
# produce match prisma/schema.prisma EXACTLY — every column, index name and
# default? `migrate diff --exit-code` answers 0 for "identical" and 2 for
# "here is what differs". Nothing else counts as passing.
#
# Two ways to use it, and it works out which from the rehearsal database:
#
#   EMPTY rehearsal db    → the whole chain from 0_init. Proves the
#                           migrations are internally consistent. Run this on
#                           your Mac before pushing.
#
#   RESTORED copy of prod → only the pending migrations, against real rows.
#                           Proves the reshape carries every row across. Run
#                           this on the server before touching the live db.
#                           Restore the copy first, as root, the way the
#                           17 September deploy did:
#
#       mysql -u root -p -e "CREATE DATABASE tacticoach_rehearsal"
#       gunzip < ~/tacticoach-2026-09-22-pre-collab.sql.gz | mysql -u root -p tacticoach_rehearsal
#
# It never touches DB_NAME itself. The connection comes from .env; only the
# database name is swapped, so no password is typed or passed anywhere.

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/db-env.sh

CHECK_DB="${DB_NAME}_rehearsal"
# Same URL, different database. Swap only the TRAILING path segment — a plain
# substitution of "/tacticoach" would hit the username first in
# mysql://tacticoach:…@host/tacticoach and rewrite the wrong half. Query
# parameters (?connection_limit=…) are kept, so this connects as the app does.
_base=${DB_URL%%\?*}
_params=${DB_URL#"${_base}"}
if [[ "${_base}" != */"${DB_NAME}" ]]; then
  echo "DATABASE_URL does not end in /${DB_NAME} — refusing to guess a rehearsal URL." >&2
  exit 1
fi
CHECK_URL="${_base%/"${DB_NAME}"}/${CHECK_DB}${_params}"

check_sql() {
  MYSQL_PWD="${DB_PASS}" mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" "${CHECK_DB}" "$@"
}

echo "Live database:      ${DB_NAME}  (not touched)"
echo "Rehearsal database: ${CHECK_DB}"
echo

# ---- Can we reach it? -------------------------------------------------------
if ! check_sql -e 'SELECT 1' >/dev/null 2>&1; then
  cat >&2 <<EOF
Cannot open ${CHECK_DB} as ${DB_USER}. Create it and grant access, as root:

  mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS ${CHECK_DB}; GRANT ALL ON ${CHECK_DB}.* TO '${DB_USER}'@'${DB_HOST}'; FLUSH PRIVILEGES;"

(If the grant fails on the host part, try '${DB_USER}'@'%'.) Then rerun this.
EOF
  exit 1
fi

# ---- Which mode? ------------------------------------------------------------
TABLES_BEFORE=$(check_sql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${CHECK_DB}'")
if [[ "${TABLES_BEFORE}" -eq 0 ]]; then
  MODE=fresh
  echo "Mode: FRESH — ${CHECK_DB} is empty, running the whole chain from 0_init."
else
  MODE=copy
  echo "Mode: COPY — ${CHECK_DB} has ${TABLES_BEFORE} tables; treating it as a restored copy."
  # Refuse to rehearse on something that is not a copy of THIS database.
  if ! check_sql -N -e "SELECT 1 FROM information_schema.tables WHERE table_schema = '${CHECK_DB}' AND table_name = '_prisma_migrations'" | grep -q 1; then
    echo "…but it has no _prisma_migrations table, so it is not a Prisma database. Refusing." >&2
    exit 1
  fi
fi
echo

# ---- Row counts before, for the tables the reshape touches ------------------
# Taken from whichever names exist, so the same code runs before and after
# the rename. A row that goes missing shows up as a mismatch below.
count_rows() {
  local table="$1"
  if check_sql -N -e "SELECT 1 FROM information_schema.tables WHERE table_schema = '${CHECK_DB}' AND table_name = '${table}'" | grep -q 1; then
    check_sql -N -e "SELECT COUNT(*) FROM \`${table}\`"
  else
    echo "-"
  fi
}

if [[ "${MODE}" == copy ]]; then
  B_PARTNERS=$(count_rows partners)
  B_COMMISSIONS=$(count_rows partner_commissions)
  B_REFERRALS=$(count_rows referrals)
  B_REWARDS=$(count_rows referral_rewards)
  B_CODES=$(check_sql -N -e "SELECT COUNT(*) FROM users WHERE referral_code IS NOT NULL" 2>/dev/null || echo "-")
  echo "Before:  partners=${B_PARTNERS}  partner_commissions=${B_COMMISSIONS}  referrals=${B_REFERRALS}  referral_rewards=${B_REWARDS}  users_with_code=${B_CODES}"
  echo
  echo "Pending on the copy:"
  DATABASE_URL="${CHECK_URL}" npx prisma migrate status 2>/dev/null | sed -n '/not yet been applied/,/^$/p' | sed 's/^/  /' || true
  echo
fi

# ---- Migrate ----------------------------------------------------------------
echo "──── prisma migrate deploy → ${CHECK_DB} ───────────────────────────────"
DATABASE_URL="${CHECK_URL}" npx prisma migrate deploy
echo

# ---- Row counts after -------------------------------------------------------
if [[ "${MODE}" == copy ]]; then
  A_COLLAB=$(count_rows collaborators)
  A_COMMISSIONS=$(count_rows collaborator_commissions)
  A_REFERRALS=$(count_rows referrals)
  A_REWARDS=$(count_rows referral_rewards)
  A_CODES=$(check_sql -N -e "SELECT COUNT(*) FROM users WHERE referral_code IS NOT NULL")
  echo "After:   collaborators=${A_COLLAB}  collaborator_commissions=${A_COMMISSIONS}  referrals=${A_REFERRALS}  referral_rewards=${A_REWARDS}  users_with_code=${A_CODES}"

  LOST=0
  [[ "${B_PARTNERS}"    == "${A_COLLAB}"       ]] || { echo "  ✗ partners ${B_PARTNERS} → collaborators ${A_COLLAB}"; LOST=1; }
  [[ "${B_COMMISSIONS}" == "${A_COMMISSIONS}"  ]] || { echo "  ✗ partner_commissions ${B_COMMISSIONS} → collaborator_commissions ${A_COMMISSIONS}"; LOST=1; }
  [[ "${B_REFERRALS}"   == "${A_REFERRALS}"    ]] || { echo "  ✗ referrals ${B_REFERRALS} → ${A_REFERRALS}"; LOST=1; }
  [[ "${B_REWARDS}"     == "${A_REWARDS}"      ]] || { echo "  ✗ referral_rewards ${B_REWARDS} → ${A_REWARDS}"; LOST=1; }
  [[ "${B_CODES}"       == "${A_CODES}"        ]] || { echo "  ✗ users with a referral code ${B_CODES} → ${A_CODES}"; LOST=1; }
  if [[ "${LOST}" -ne 0 ]]; then
    echo "ROWS WENT MISSING. Do not deploy. Send the lines above." >&2
    exit 1
  fi
  echo "  ✓ every row carried across"

  # The rate mapping, so a human can eyeball it against the agreements.
  if [[ "${A_COLLAB}" != "-" && "${A_COLLAB}" -gt 0 ]]; then
    echo
    echo "Collaborator rates after the reshape (old single rate copied to both):"
    check_sql --table -e "SELECT c.id, u.email, c.status, c.coach_rate, c.club_rate FROM collaborators c JOIN users u ON u.id = c.user_id ORDER BY c.id"
  fi
  echo
fi

# ---- The real test ----------------------------------------------------------
echo "──── prisma migrate diff: ${CHECK_DB} vs prisma/schema.prisma ─────────"
set +e
DATABASE_URL="${CHECK_URL}" npx prisma migrate diff \
  --from-url "${CHECK_URL}" \
  --to-schema prisma/schema.prisma \
  --script --exit-code > /tmp/migration-drift.sql 2>/tmp/migration-drift.err
RC=$?
set -e

case "${RC}" in
  0)
    echo "  ✓ NO DRIFT — the migrated database matches the schema exactly."
    ;;
  2)
    echo "  ✗ DRIFT. Prisma would still need to run this to match the schema:" >&2
    echo >&2
    sed 's/^/    /' /tmp/migration-drift.sql >&2
    echo >&2
    echo "  Do not deploy. That SQL is the gap between the migrations and the schema." >&2
    exit 2
    ;;
  *)
    echo "  ✗ migrate diff itself failed (exit ${RC}):" >&2
    sed 's/^/    /' /tmp/migration-drift.err >&2
    exit "${RC}"
    ;;
esac

cat <<EOF

PASSED on ${CHECK_DB}.

When you are done with it:
  mysql -u root -p -e "DROP DATABASE ${CHECK_DB}"
EOF
