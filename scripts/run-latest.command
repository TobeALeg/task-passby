#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
cd "$PROJECT_ROOT"

ELECTRON_EXECUTABLE="$PROJECT_ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
RUNNING_PIDS="$(pgrep -f "$ELECTRON_EXECUTABLE . --dev" || true)"
if [[ -n "$RUNNING_PIDS" ]]; then
  kill $RUNNING_PIDS
  for _ in {1..50}; do
    pgrep -f "$ELECTRON_EXECUTABLE . --dev" >/dev/null || break
    sleep 0.1
  done
fi

exec npm run dev
