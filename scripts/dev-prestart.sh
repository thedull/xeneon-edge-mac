#!/usr/bin/env bash
# Dev-only: end a prior instance of THIS project before `npm start`, so your
# newest code wins instead of the single-instance lock keeping the old one alive.
# Targets only this repo's Electron + touch-helper processes by their full path —
# other Electron apps are left untouched. Never fails the start.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# SIGTERM lets the app run its quit handlers (server.stop() releases the port,
# touchDriver.stop() kills the helper).
pkill -f "${ROOT}/node_modules/electron" 2>/dev/null || true
pkill -f "${ROOT}/sidecars/xeneon-touch" 2>/dev/null || true

# Wait (up to ~3s) for port 8787 to be released before the new server binds.
for _ in $(seq 1 30); do
  if ! lsof -nP -iTCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.1
done
exit 0
