#!/usr/bin/env bash
#
# Back up the database this checkout points at.
#
#   cd tacticoach-api
#   bash scripts/backup-db.sh
#
# The rollback in DEPLOY_RUNBOOK.md §7 IS this file. Seven migrations, two
# table renames and a column split land in one step — there is no undo without
# it.

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/db-env.sh

# Gzipped, for two reasons: it matches the dumps already in ~ on the production
# box (tacticoach-2026-09-17-pre22.sql.gz), and that box was last seen at 82%
# disk. A backup that fills the disk it is protecting is not a backup.
OUT=~/tacticoach-backup-$(date +%F-%H%M).sql.gz
db_banner
echo "Dumping to ${OUT} …"
# pipefail (set above) matters here: without it, gzip succeeding would mask
# mysqldump failing, and you would get a small, valid, EMPTY archive.
dump_db --single-transaction --quick --routines --triggers | gzip > "${OUT}"

echo "Done: $(ls -lh "${OUT}" | awk '{print $5}')  ${OUT}"

# ---- Verify by READING IT BACK, not by looking at the file ------------------
#
# This used to be a single check: is the file at least 10 KB? That was written
# for a plain .sql dump. Now that the output is gzipped it is close to
# worthless — gzip gets roughly 10:1 on SQL, and a test dump of 200 CREATE
# TABLE statements compressed to 523 bytes. A threshold tuned for uncompressed
# text will wave through a compressed archive holding almost nothing.
#
# So the size floor stays only as a crude "is there a file at all", and the
# checks that actually decide are the two below, both of which decompress.

if ! gunzip -t "${OUT}" 2>/dev/null; then
  echo "REFUSING: ${OUT} is not a readable gzip archive." >&2
  exit 1
fi

# The real check. `grep -c` on the decompressed stream, so this is the table
# count in the archive rather than the table count we hoped for.
TABLES=$(gunzip -c "${OUT}" | grep -c 'CREATE TABLE' || true)
echo "Tables captured: ${TABLES}"
if [[ "${TABLES}" -lt 10 ]]; then
  echo "REFUSING: only ${TABLES} tables — this database has far more." >&2
  exit 1
fi

# mysqldump writes this as its last line. Its absence is the signature of a
# dump that was cut off partway — which is exactly the case that produces a
# plausible-looking file with a plausible-looking table count.
if ! gunzip -c "${OUT}" | tail -5 | grep -q 'Dump completed'; then
  echo "REFUSING: no 'Dump completed' marker — ${OUT} is truncated." >&2
  exit 1
fi

echo
echo "Restore with:"
echo "  bash -c 'source scripts/db-env.sh && gunzip < ${OUT} | run_sql'"
