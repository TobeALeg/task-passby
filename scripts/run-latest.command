#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
cd "$PROJECT_ROOT"

PACKAGED_EXECUTABLE="$PROJECT_ROOT/release/Worket-darwin-arm64/Worket.app/Contents/MacOS/Worket"
LEGACY_DEVELOPMENT_EXECUTABLE="$PROJECT_ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
LEGACY_PACKAGED_EXECUTABLE="$PROJECT_ROOT/release/WorkPet-darwin-arm64/WorkPet.app/Contents/MacOS/WorkPet"
APP_PROCESS_PATTERN="$PACKAGED_EXECUTABLE|$LEGACY_PACKAGED_EXECUTABLE|$LEGACY_DEVELOPMENT_EXECUTABLE . --dev"
RUNNING_PIDS="$(pgrep -f "$APP_PROCESS_PATTERN" || true)"
if [[ -n "$RUNNING_PIDS" ]]; then
  kill $RUNNING_PIDS
  for _ in {1..50}; do
    pgrep -f "$APP_PROCESS_PATTERN" >/dev/null || break
    sleep 0.1
  done
fi

exec npm run dev
