#!/usr/bin/env bash
# hstack brain — weekly telemetry collection + AI analysis.
#
# 1. Collection (free, pure Python): runs report.py against every consuming
#    repo listed in HSTACK_REPOS (or ui/.env.local), writing dated .md/.json
#    snapshots into each repo's hstack/telemetry/reports/.
# 2. Analysis (one Claude Code headless session): follows brain/ANALYSIS.md
#    and writes/updates recommendations under brain/recommendations/.
#
# Run manually:  ./scripts/brain-weekly.sh
# Scheduled:     via the launchd agent ai.gomoso.hstack-brain-weekly
#                (see scripts/install-brain-cron.sh)

set -euo pipefail

HSTACK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${HSTACK_ROOT}/.brain-logs"
mkdir -p "$LOG_DIR"

# Repo list: HSTACK_REPOS env var, else ui/.env.local (single source of truth
# with the telemetry UI).
if [ -z "${HSTACK_REPOS:-}" ] && [ -f "$HSTACK_ROOT/ui/.env.local" ]; then
  HSTACK_REPOS="$(grep -E '^HSTACK_REPOS=' "$HSTACK_ROOT/ui/.env.local" | head -1 | cut -d= -f2-)"
fi
if [ -z "${HSTACK_REPOS:-}" ]; then
  echo "error: HSTACK_REPOS not set and ui/.env.local not found" >&2
  exit 1
fi

echo "== hstack brain weekly — $(date '+%Y-%m-%d %H:%M') =="

IFS=',' read -ra REPOS <<< "$HSTACK_REPOS"
COLLECTED=()
for repo in "${REPOS[@]}"; do
  repo="$(echo "$repo" | xargs)"
  [ -d "$repo" ] || { echo "skip (missing): $repo"; continue; }
  echo "-- collecting: $repo"
  if python3 "$HSTACK_ROOT/template/scripts/telemetry/report.py" \
      --repo "$repo" --window 30 2>&1 | tail -2; then
    COLLECTED+=("$repo")
  else
    echo "warn: collection failed for $repo (continuing)" >&2
  fi
done

if [ "${#COLLECTED[@]}" -eq 0 ]; then
  echo "error: no repo collected; skipping analysis" >&2
  exit 1
fi

echo "-- analysis (claude headless, cwd: $HSTACK_ROOT)"
PROMPT="Read brain/ANALYSIS.md and execute it exactly. The consuming repos analyzed this week are: ${COLLECTED[*]}. Their fresh telemetry JSONs are at <repo>/hstack/telemetry/reports/$(date '+%Y-%m-%d').json. Do not commit anything."

cd "$HSTACK_ROOT"
claude -p "$PROMPT" \
  --permission-mode acceptEdits \
  --allowed-tools "Read,Write,Edit,Glob,Grep,Bash(ls*),Bash(cat*)" \
  > "$LOG_DIR/$(date '+%Y-%m-%d').log" 2>&1 || {
    echo "warn: analysis session exited non-zero — see $LOG_DIR/$(date '+%Y-%m-%d').log" >&2
    exit 1
  }

echo "== done — analysis log: $LOG_DIR/$(date '+%Y-%m-%d').log =="
