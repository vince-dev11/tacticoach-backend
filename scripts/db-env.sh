# Connection details for the database this checkout points at.
#
#   source scripts/db-env.sh
#   run_sql < some.sql
#
# SOURCED, not executed. Every db script needs the same four values and the
# same parsing, and the parser had already been copied once — a third copy is
# how one of them quietly keeps the bug the others had fixed.
#
# Two things it deliberately does:
#
#   * Reads DATABASE_URL from .env rather than taking host/user/password as
#     arguments. A password on a command line lands in shell history and is
#     visible in `ps` to every user on the box.
#   * Uses no placeholders. The runbook used to say `-h <PROD_HOST>`, which is
#     both a thing to substitute and — because `<` is a redirection in bash —
#     a syntax error if you paste it as written. Nothing here needs editing.

if [[ ! -f .env ]]; then
  echo "No .env in $(pwd)." >&2
  echo "Run this from the tacticoach-api directory (cd into the repo first)." >&2
  return 1 2>/dev/null || exit 1
fi

DB_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"'"'")
if [[ -z "${DB_URL}" ]]; then
  echo "No DATABASE_URL in .env." >&2
  return 1 2>/dev/null || exit 1
fi

# mysql://user:pass@host:port/database?params
_rest=${DB_URL#*://}
# Split on the LAST @: database passwords contain @ far more often than
# hostnames do, and splitting on the first cuts the password in half and then
# fails with a confusing message about the host.
_creds=${_rest%@*}
_hostpart=${_rest##*@}
DB_USER=${_creds%%:*}
DB_PASS=${_creds#*:}
DB_HOST=${_hostpart%%:*}
_after_host=${_hostpart#*:}
DB_PORT=${_after_host%%/*}
DB_NAME=${_after_host#*/}
DB_NAME=${DB_NAME%%\?*}

# No port in the URL leaves DB_PORT holding the rest of the string.
if [[ ! "${DB_PORT}" =~ ^[0-9]+$ ]]; then
  DB_PORT=3306
  DB_HOST=${_hostpart%%/*}
  DB_NAME=${_hostpart#*/}
  DB_NAME=${DB_NAME%%\?*}
fi

run_sql() {
  MYSQL_PWD="${DB_PASS}" mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" "${DB_NAME}" "$@"
}

dump_db() {
  # --no-tablespaces: MySQL 8 makes mysqldump ask for the PROCESS privilege
  # to list NDB tablespaces, which the app user does not have and InnoDB does
  # not use. Without the flag it prints an "Access denied" that looks like the
  # dump failed. It did not — but the flag removes the doubt.
  MYSQL_PWD="${DB_PASS}" mysqldump --no-tablespaces -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" "${DB_NAME}" "$@"
}

db_banner() {
  echo "Database: ${DB_NAME} on ${DB_HOST}:${DB_PORT} as ${DB_USER}"
}
