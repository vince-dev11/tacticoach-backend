#!/usr/bin/env bash
# Build a FRESH local database. Never run this on the server.
#
# Why this exists instead of `prisma migrate reset`: Prisma applies migrations
# in ALPHABETICAL folder order, and this project's early migrations were
# numbered without zero-padding. So on an empty database `22_squads` runs
# before `6_coach_context` (and 2_, 3_ … 9_ all run after 19_), and 22 fails
# reading a column 6 has not created yet.
#
# Production is unaffected: it received each migration as it was written, in
# the right order, and its history is recorded by folder NAME — which is also
# why the folders cannot simply be renamed now.
#
# So a fresh database is built the way Prisma calls "baselining": create the
# tables straight from schema.prisma (which is what the migrations add up to —
# migration 33 and scripts/verify-migrations.sh prove there is no drift), then
# record every migration as already applied. Migrations added after this run
# normally with `prisma migrate deploy`.
#
# Usage:  bash scripts/fresh-local-db.sh        (asks before wiping)

set -euo pipefail
cd "$(dirname "$0")/.."

if ! grep -Eq 'DATABASE_URL=.*(localhost|127\.0\.0\.1)' .env 2>/dev/null; then
  echo "Refusing: DATABASE_URL in .env does not point at localhost. This script is for a local database only." >&2
  exit 1
fi

read -r -p "This DELETES everything in your LOCAL database. Type 'wipe' to continue: " answer
[ "$answer" = "wipe" ] || { echo "Cancelled."; exit 1; }

echo "1/4  Recreating the database from schema.prisma…"
npx prisma db push --force-reset --accept-data-loss

echo "2/4  Recording every migration as applied…"
for dir in prisma/migrations/*/; do
  name="$(basename "$dir")"
  npx prisma migrate resolve --applied "$name" >/dev/null
  echo "     ✓ $name"
done

echo "3/4  Generating the Prisma client…"
npx prisma generate >/dev/null

echo "4/4  Seeding plans and defaults…"
npx tsx prisma/seed.ts

echo
npx prisma migrate status
