#!/usr/bin/env bash
# Installs (or reinstalls) the launchd agent that runs scripts/brain-weekly.sh
# every Monday at 09:07 local time. Idempotent — re-run after moving the repo.
#
#   ./scripts/install-brain-cron.sh            # install against this checkout
#   launchctl list | grep hstack-brain         # verify
#   tail -f .brain-logs/launchd.log            # watch a run

set -euo pipefail

HSTACK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="ai.gomoso.hstack-brain-weekly"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HSTACK_ROOT/.brain-logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${HSTACK_ROOT}/scripts/brain-weekly.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>9</integer>
    <key>Minute</key><integer>7</integer>
  </dict>
  <key>StandardOutPath</key><string>${HSTACK_ROOT}/.brain-logs/launchd.log</string>
  <key>StandardErrorPath</key><string>${HSTACK_ROOT}/.brain-logs/launchd.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "installed: $LABEL → runs Mondays 09:07, repo: $HSTACK_ROOT"
echo "test now with: launchctl start $LABEL"
