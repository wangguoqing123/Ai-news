#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
BASE_ENV_FILE="$PROJECT_DIR/.env.local"
ENV_FILE="$PROJECT_DIR/.env.worker.local"
if [[ ! -f "$ENV_FILE" ]]; then
  print -u2 "Missing $ENV_FILE"
  exit 1
fi

umask 077
set -a
[[ -f "$BASE_ENV_FILE" ]] && source "$BASE_ENV_FILE"
source "$ENV_FILE"
set +a
if [[ -z "${DATABASE_URL:-}" ]]; then
  DB_PASSWORD="$(security find-generic-password -a postgres -s signal-desk-supabase-db-jsdpfgjdrkveogofyoki -w)"
  ENCODED_DB_PASSWORD="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$DB_PASSWORD")"
  export DATABASE_URL="postgresql://${DATABASE_POOLER_USER}:${ENCODED_DB_PASSWORD}@${DATABASE_POOLER_HOST}:${DATABASE_POOLER_PORT:-5432}/${DATABASE_NAME:-postgres}"
  unset DB_PASSWORD ENCODED_DB_PASSWORD
fi
cd "$PROJECT_DIR"
exec node --import tsx jobs-worker/index.ts
