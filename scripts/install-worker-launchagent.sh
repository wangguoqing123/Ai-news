#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASE_ENV_FILE="$PROJECT_DIR/.env.local"
ENV_FILE="$PROJECT_DIR/.env.worker.local"
LABEL="com.wangguoqing.signal-desk-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
RUNTIME_DIR="$HOME/Library/Application Support/Signal Desk Worker"
NODE_BIN_DIR="$(dirname "$(command -v node)")"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi
if [[ ! -f "$BASE_ENV_FILE" ]]; then
  echo "Missing $BASE_ENV_FILE" >&2
  exit 1
fi
for key in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  grep -q "^${key}=" "$BASE_ENV_FILE" || { echo "Missing $key in $BASE_ENV_FILE" >&2; exit 1; }
done
for key in AI_PROVIDER TRANSCRIPT_PROVIDER_CHAIN; do
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    echo "Missing $key in $ENV_FILE" >&2
    exit 1
  fi
done
if ! grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  for key in DATABASE_POOLER_HOST DATABASE_POOLER_USER; do
    grep -q "^${key}=" "$ENV_FILE" || { echo "Missing $key in $ENV_FILE" >&2; exit 1; }
  done
  security find-generic-password -a postgres -s signal-desk-supabase-db-jsdpfgjdrkveogofyoki >/dev/null || { echo "Missing Supabase database password in Keychain" >&2; exit 1; }
fi
if grep -q '^AI_PROVIDER=codex_cli$' "$ENV_FILE"; then
  grep -q '^CODEX_CLI_PATH=' "$ENV_FILE" || { echo "Missing CODEX_CLI_PATH in $ENV_FILE" >&2; exit 1; }
else
  for key in AI_API_KEY AI_MODEL AI_EMBEDDING_MODEL; do
    grep -q "^${key}=" "$ENV_FILE" || { echo "Missing $key in $ENV_FILE" >&2; exit 1; }
  done
fi
chmod 600 "$ENV_FILE"
mkdir -p "$(dirname "$PLIST")" "$LOG_DIR" "$RUNTIME_DIR"
launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
rm -f "$RUNTIME_DIR/worker.mjs" "$RUNTIME_DIR/worker.mjs.map"
"$PROJECT_DIR/node_modules/.bin/esbuild" "$PROJECT_DIR/jobs-worker/index.ts" --bundle --platform=node --format=cjs --target=node22 --outfile="$RUNTIME_DIR/worker.cjs" --sourcemap=external
install -m 700 "$PROJECT_DIR/scripts/run-worker-runtime.sh" "$RUNTIME_DIR/run-worker-runtime.sh"
install -m 600 "$BASE_ENV_FILE" "$RUNTIME_DIR/.env.local"
install -m 600 "$ENV_FILE" "$RUNTIME_DIR/.env.worker.local"
TEMP_PLIST="$(mktemp)"
trap 'rm -f "$TEMP_PLIST"' EXIT
cat > "$TEMP_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$RUNTIME_DIR/run-worker-runtime.sh</string></array>
  <key>WorkingDirectory</key><string>$RUNTIME_DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE_BIN_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/signal-desk-worker.out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/signal-desk-worker.err.log</string>
</dict></plist>
PLIST
plutil -lint "$TEMP_PLIST" >/dev/null
install -m 600 "$TEMP_PLIST" "$PLIST"
launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl kickstart -k "gui/$UID/$LABEL"
echo "$LABEL installed"
