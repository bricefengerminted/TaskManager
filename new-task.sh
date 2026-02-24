#!/bin/bash
# ──────────────────────────────────────────────
# new-task.sh — Open TaskManager and start the New Task flow
#
# If servers are running + app window open: navigates to ?action=new-task
# If servers are running but no app window: opens a new --app window
# If not running: starts servers, then opens with ?action=new-task
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
TARGET_URL="localhost:$FRONTEND_PORT"
NEW_TASK_URL="http://$TARGET_URL/?action=new-task"

# ── Helper: open a new --app window (same as start.sh does) ──
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
      return
    fi
  done
  # No Chromium browser found — fallback to plain open
  open "$url"
}

# ── If servers are running, find the app window or open one ──
if /usr/bin/curl -s --max-time 2 "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then

  RESULT=$(osascript <<EOF 2>&1
tell application "Google Chrome"
    repeat with w from 1 to (count of windows)
        repeat with t from 1 to (count of tabs of window w)
            if URL of tab t of window w contains "$TARGET_URL" then
                set active tab index of window w to t
                set miniaturized of window w to false
                set visible of window w to true
                set index of window w to 1
                set URL of tab t of window w to "$NEW_TASK_URL"
                delay 1
                activate
                return "ok"
            end if
        end repeat
    end repeat
    return "not_found"
end tell
EOF
  )

  case "$RESULT" in
    "ok")
      ;; # App window found, navigated, and focused
    *)
      # No app window open — launch a new --app window with the action URL
      open_app_window "$NEW_TASK_URL"
      ;;
  esac

  exit 0
fi

# ── Servers not running — start them, then open with action param ──
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
