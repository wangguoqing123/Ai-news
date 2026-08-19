#!/bin/zsh
set -euo pipefail

RUNTIME_DIR="${0:A:h}"
umask 077
set -a
source "$RUNTIME_DIR/.env.local"
source "$RUNTIME_DIR/.env.worker.local"
set +a
if [[ -z "${DATABASE_URL:-}" ]]; then
  export DATABASE_CREDENTIAL_SOURCE="keychain"
  export DATABASE_KEYCHAIN_SERVICE="signal-desk-supabase-db-jsdpfgjdrkveogofyoki"
  DB_PASSWORD="$(security find-generic-password -a postgres -s signal-desk-supabase-db-jsdpfgjdrkveogofyoki -w)"
  ENCODED_DB_PASSWORD="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$DB_PASSWORD")"
  export DATABASE_URL="postgresql://${DATABASE_POOLER_USER}:${ENCODED_DB_PASSWORD}@${DATABASE_POOLER_HOST}:${DATABASE_POOLER_PORT:-5432}/${DATABASE_NAME:-postgres}"
  unset DB_PASSWORD ENCODED_DB_PASSWORD
fi
cd "$RUNTIME_DIR"
exec node worker.cjs
