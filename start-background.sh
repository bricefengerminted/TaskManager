#!/bin/bash
# ──────────────────────────────────────────────
# TaskManager — background launcher
# Runs the app detached from the terminal so
# closing Terminal won't kill it.
# ──────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/.logs"
PID_FILE="$LOG_DIR/taskmanager.pid"
mkdir -p "$LOG_DIR"

# If already running, just open the browser
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "TaskManager is already running."
  open "http://localhost:5173" 2>/dev/null
  exit 0
fi

# Launch start.sh fully detached (nohup + disown)
nohup "$SCRIPT_DIR/start.sh" > "$LOG_DIR/launcher.log" 2>&1 &
echo $! > "$PID_FILE"
disown

echo "TaskManager started in the background."
echo "Logs: $LOG_DIR/"
echo ""
echo "You can close this terminal — the app will keep running."
echo "To stop it later, run:  $SCRIPT_DIR/stop.sh"
