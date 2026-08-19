#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
BASE_ENV_FILE="$PROJECT_DIR/.env.local"
ENV_FILE="$PROJECT_DIR/.env.worker.local"
if [[ ! -f "$ENV_FILE" ]]; then
  print -u2 "Missing $ENV_FILE"
  exit 1
fi
set -a
[[ -f "$BASE_ENV_FILE" ]] && source "$BASE_ENV_FILE"
source "$ENV_FILE"
set +a
cd "$PROJECT_DIR"
exec node --import tsx scripts/worker-status.ts
