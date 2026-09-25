#!/usr/bin/env bash
#
# Deploy the API on the production box, in the order that cannot take the
# site down half-way:
#
#   backup → pull → install → generate → migrate → build → restart → smoke
#
#   ssh ubuntu@13.53.60.120
#   cd /var/www/html/tacticoach-backend && bash scripts/deploy-api.sh
#
# Every step is checked. A failed migration or build leaves pm2 running the
# OLD build on the OLD schema, which is a working site — the script says so
# and stops. It never restarts on a failed build (`&&` below is the point).
#
# Nothing here reads or prints secrets. .env is only used by the processes
# that always used it.

set -euo pipefail
cd "$(dirname "$0")/.."
APP=tacticoach-api

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ -f .env ] || die ".env missing in $(pwd)"
command -v pm2 >/dev/null || die "pm2 not found"

say "0. Disk"
df -h / | tail -1
FREE_KB=$(df -k / | tail -1 | awk '{print $4}')
[ "$FREE_KB" -gt 800000 ] || die "Under 800 MB free. Run: npm cache clean --force; remove old ~/*.sql.gz you have already used."

say "1. Backup (this is the rollback — do not skip)"
bash scripts/backup-db.sh

say "2. Pull"
git fetch --all --quiet
BEFORE=$(git rev-parse --short HEAD)
git pull --ff-only
AFTER=$(git rev-parse --short HEAD)
echo "code: $BEFORE → $AFTER"

say "3. Install + Prisma client"
# Full install: the build needs devDependencies (tsc, tsx, @types/*).
npm install --no-audit --no-fund
npx prisma generate

say "4. Migrations"
npx prisma migrate status || true
echo
read -r -p "Apply pending migrations now? [y/N] " yn
[ "${yn:-N}" = "y" ] || die "Stopped before migrating. Site unchanged."
npx prisma migrate deploy || die "migrate deploy FAILED. Do NOT restart pm2 — the old build is still serving. Paste the error."

say "5. Build (restart only if it succeeds)"
npm run build || die "Build FAILED. pm2 still runs the previous build. Fix, then re-run this script."

say "6. Restart"
export SENTRY_RELEASE="$AFTER"
pm2 restart "$APP" --update-env
sleep 3
pm2 status "$APP" | tail -4

say "7. Smoke"
for i in 1 2 3 4 5; do
  if curl -fsS -m 5 http://127.0.0.1:${PORT:-3001}/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS -m 5 "http://127.0.0.1:${PORT:-3001}/health" || die "/health not answering — check: pm2 logs $APP --lines 60"
echo
curl -s -o /dev/null -w "preflight max-age: %{http_code}\n" -X OPTIONS "http://127.0.0.1:${PORT:-3001}/api/users/me" \
  -H "Origin: https://app.tacticoach.co.uk" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization" -D - | grep -i "access-control-max-age" || echo "(max-age header not seen — CORS_ORIGINS may not include the app origin)"
pm2 logs "$APP" --lines 25 --nostream | tail -25

say "Done. API at $AFTER. Boot line should read 'Error tracking: Sentry on' once SENTRY_DSN is in .env."
