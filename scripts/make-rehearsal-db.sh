#!/usr/bin/env bash
#
# Build <DB_NAME>_rehearsal as a copy of the newest backup, so that
# scripts/verify-migrations.sh has something real to rehearse on.
#
#   bash scripts/make-rehearsal-db.sh                 # newest ~/tacticoach-backup-*.sql.gz
#   bash scripts/make-rehearsal-db.sh ~/some.sql.gz   # a specific one
#
# Uses `sudo mysql` for the root-only parts (CREATE DATABASE, GRANT, restore)
# — on this server root authenticates over the socket, so nothing is typed.
# The grant goes to the app user from .env, at every host that user exists
# for, because MySQL 8 will NOT create a user as a side effect of GRANT and
# guessing 'localhost' when the user is '%' just fails.
#
# Refuses to overwrite: if the rehearsal database already has tables, it
# says how to drop it and stops. A rehearsal on top of a previous rehearsal
# proves nothing.

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/db-env.sh

REH="${DB_NAME}_rehearsal"
BACKUP="${1:-$(ls -t ~/tacticoach-backup-*.sql.gz 2>/dev/null | head -1 || true)}"

if [[ -z "${BACKUP}" || ! -f "${BACKUP}" ]]; then
  echo "No backup found. Run  bash scripts/backup-db.sh  first, or pass the file." >&2
  exit 1
fi
if ! gunzip -t "${BACKUP}" 2>/dev/null; then
  echo "${BACKUP} is not a readable gzip archive." >&2
  exit 1
fi

if ! sudo -n mysql -e 'SELECT 1' >/dev/null 2>&1; then
  echo "sudo mysql did not work here — root is not on socket auth. Ask for the root password before going on." >&2
  exit 1
fi

HOSTS=$(sudo mysql -N -e "SELECT host FROM mysql.user WHERE user = '${DB_USER}'")
if [[ -z "${HOSTS}" ]]; then
  echo "MySQL has no user named ${DB_USER} — but .env connects as it? Stop and check." >&2
  exit 1
fi

EXISTING=$(sudo mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${REH}'")
if [[ "${EXISTING}" -gt 0 ]]; then
  echo "${REH} already exists with ${EXISTING} tables. Drop it first:" >&2
  echo "  sudo mysql -e \"DROP DATABASE ${REH}\"" >&2
  exit 1
fi

echo "Live database:      ${DB_NAME}  (not touched)"
echo "Rehearsal database: ${REH}"
echo "From backup:        ${BACKUP}  ($(ls -lh "${BACKUP}" | awk '{print $5}'))"
echo

sudo mysql -e "CREATE DATABASE IF NOT EXISTS \`${REH}\`"
for h in ${HOSTS}; do
  sudo mysql -e "GRANT ALL ON \`${REH}\`.* TO '${DB_USER}'@'${h}'"
  echo "Granted ${DB_USER}@${h} on ${REH}"
done
sudo mysql -e "FLUSH PRIVILEGES"

echo "Restoring …"
gunzip < "${BACKUP}" | sudo mysql "${REH}"

TABLES=$(sudo mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${REH}'")
echo "Done: ${REH} has ${TABLES} tables."
echo
echo "Next:  bash scripts/verify-migrations.sh"
echo "After: sudo mysql -e \"DROP DATABASE ${REH}\""
