#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.worker.local"
LABEL="com.wangguoqing.signal-desk-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
NODE_BIN_DIR="$(dirname "$(command -v node)")"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi
for key in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY DATABASE_URL AI_API_KEY AI_MODEL AI_EMBEDDING_MODEL TRANSCRIPT_PROVIDER_CHAIN; do
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    echo "Missing $key in $ENV_FILE" >&2
    exit 1
  fi
done
chmod 600 "$ENV_FILE"
mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
TEMP_PLIST="$(mktemp)"
trap 'rm -f "$TEMP_PLIST"' EXIT
cat > "$TEMP_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$PROJECT_DIR/scripts/run-worker.sh</string></array>
  <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
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
