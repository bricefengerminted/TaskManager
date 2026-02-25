#!/bin/bash
# ──────────────────────────────────────────────
# new-task.sh — Open TaskManager and start the New Task flow
#
# If app window exists: bring to front and navigate to ?action=new-task
# If servers running but no window: open --app window with ?action=new-task
# If nothing running: start servers, wait, then open with ?action=new-task
# ──────────────────────────────────────────────

# ── Fix PATH for Stream Deck / Finder context ──
for p in /opt/homebrew/bin /usr/local/bin "$HOME/.nvm/current/bin" "$HOME/.fnm/aliases/default/bin" "$HOME/.volta/bin"; do
  [ -d "$p" ] && export PATH="$p:$PATH"
done
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh" 2>/dev/null
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_PORT=5173
NEW_TASK_URL="http://localhost:$FRONTEND_PORT/?action=new-task"

# ── Helper: open a new --app window (same approach as start.sh) ──
open_app_window() {
  local url="$1"
  for BROWSER in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"; do
    if [ -f "$BROWSER" ]; then
      "$BROWSER" --app="$url" &>/dev/null &
      return 0
    fi
  done
  return 1
}

# ── Try to find existing window, bring to front, and navigate ──
RESULT=$(osascript <<'APPLESCRIPT' 2>&1
tell application "Google Chrome"
    repeat with w in windows
        if name of w contains "TaskManager" then
            set index of w to 1
            set URL of active tab of w to "http://localhost:5173/?action=new-task"
            delay 1
            activate
            return "ok"
        end if
    end repeat
    return "not_found"
end tell
APPLESCRIPT
)

if [ "$RESULT" = "ok" ]; then
  exit 0
fi

# ── No existing window found ──

# If servers are running, just open a new --app window with the action
if /usr/bin/curl -s --max-time 2 "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
  open_app_window "$NEW_TASK_URL"
  exit 0
fi

# Servers not running — start them, wait, then open
if [ -f "$SCRIPT_DIR/start.sh" ]; then
  open -a Terminal "$SCRIPT_DIR/start.sh"

  for i in $(seq 1 30); do
    if /usr/bin/curl -s --max-time 2 "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
      sleep 1
      open_app_window "$NEW_TASK_URL"
      exit 0
    fi
    sleep 1
  done
fi
