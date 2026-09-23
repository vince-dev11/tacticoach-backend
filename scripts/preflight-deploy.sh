#!/usr/bin/env bash
#
# Read-only production check. Changes nothing.
#
#   cd /var/www/html/tacticoach-backend        # production
#   bash scripts/preflight-deploy.sh
#
# Confirms the database is where the runbook assumes before migration 25
# reshapes it: 17_referrals_partners applied, nothing in a failed state, and
# the row counts the reshape has to carry across.
#
# NOTE: production runs under pm2, not Docker — `docker` is not installed on
# that box. So a failed `migrate deploy` does NOT take the API down; pm2 keeps
# serving the build already on disk. The danger is restarting anyway, putting
# new code in front of a half-migrated schema. Which is why this runs first.

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/db-env.sh

db_banner
echo
run_sql --table < scripts/preflight-deploy.sql
echo
cat <<'NEXT'
────────────────────────────────────────────────────────────────────────────
Section 1 EXPECTED      → good. Back up, rehearse on a copy, then deploy.
Section 1 UNEXPECTED    → stop; paste sections 1, 3 and 4.
Section 2               → write these numbers down. After the deploy they
                          must match exactly (scripts/verify-migrations.sh
                          checks this for you on the rehearsal copy).
Section 3 above 0       → npx prisma migrate resolve --rolled-back <that name>
                          before anything else, or every deploy answers P3009.
NEXT
