#!/bin/bash
# ──────────────────────────────────────────────
# TaskManager — stop background processes
# ──────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/.logs/taskmanager.pid"

# Kill by PID file
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    # Kill the process group so child processes (backend/frontend) also stop
    kill -- -"$PID" 2>/dev/null || kill "$PID" 2>/dev/null
  fi
  rm -f "$PID_FILE"
fi

# Also kill anything on the known ports as a safety net
for port in 3001 5173; do
  pid=$(lsof -ti :"$port" 2>/dev/null)
  [ -n "$pid" ] && kill "$pid" 2>/dev/null
done

echo "TaskManager stopped."
