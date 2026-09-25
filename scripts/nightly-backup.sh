#!/usr/bin/env bash
#
# Nightly production backup. Run by cron, not by hand (though by hand is fine).
#
#   crontab -e
#   30 2 * * * cd /var/www/html/tacticoach-backend && bash scripts/nightly-backup.sh >> $HOME/backups/backup.log 2>&1
#
# 1. Dump and VERIFY  — scripts/backup-db.sh: gzip integrity, table count,
#                       and mysqldump's "Dump completed" marker. It refuses
#                       to call a truncated dump a backup.
# 2. Ship it off the server — scripts/upload-backup.mjs, with write-only keys.
#                       A backup on the same disk as the database dies with it.
# 3. Keep the last 7 locally — for a fast restore without a download, and so a
#                       failing upload does not silently leave you with none.
# 4. Report          — optional ping to BACKUP_HEARTBEAT_URL (e.g. a free
#                       healthchecks.io check). The one failure a backup job
#                       cannot report on its own is not running at all; a
#                       heartbeat that stops arriving is how you find out.

set -euo pipefail
cd "$(dirname "$0")/.."

export BACKUP_DIR="${HOME}/backups"
mkdir -p "${BACKUP_DIR}"
KEEP_LOCAL=7
HEARTBEAT=$(grep -E '^BACKUP_HEARTBEAT_URL=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'" || true)

echo "==== $(date -u +%FT%TZ) nightly backup ===="

fail() {
  echo "FAILED: $*" >&2
  [[ -n "${HEARTBEAT}" ]] && curl -fsS -m 10 --retry 3 "${HEARTBEAT}/fail" >/dev/null || true
  exit 1
}

bash scripts/backup-db.sh || fail "dump or verification"

FILE=$(ls -t "${BACKUP_DIR}"/tacticoach-backup-*.sql.gz 2>/dev/null | head -1)
[[ -n "${FILE}" ]] || fail "no backup file found after dump"

node scripts/upload-backup.mjs "${FILE}" || fail "upload of ${FILE} (kept locally)"

# Local retention: newest KEEP_LOCAL files stay, older go. Only files this
# job's naming pattern produced — nothing else in the folder is touched.
ls -t "${BACKUP_DIR}"/tacticoach-backup-*.sql.gz | tail -n +$((KEEP_LOCAL + 1)) | while read -r old; do
  rm -f -- "${old}" && echo "pruned ${old}"
done

[[ -n "${HEARTBEAT}" ]] && curl -fsS -m 10 --retry 3 "${HEARTBEAT}" >/dev/null || true
echo "OK"
