#!/bin/bash
# ──────────────────────────────────────────────
# new-task.sh — Open TaskManager and start the New Task flow
#
# If servers are running: brings window to front and opens the modal
#   via JavaScript (no page reload, no flash)
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

# ── If servers are running, trigger new-task modal ──
if /usr/bin/curl -s --max-time 2 "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then

  # Find the tab, call the global JS function, and activate Chrome.
  # The delay lets Stream Deck release focus before we activate.
  osascript <<EOF 2>/dev/null
tell application "Google Chrome"
    repeat with w from 1 to (count of windows)
        repeat with t from 1 to (count of tabs of window w)
            if URL of tab t of window w contains "$TARGET_URL" then
                set active tab index of window w to t
                set index of window w to 1
                execute tab t of window w javascript "window.__openNewTask && window.__openNewTask()"
                delay 0.5
                activate
                return
            end if
        end repeat
    end repeat
end tell
EOF

  exit 0
fi

# ── Servers not running — start them, then open with action param ──
if [ -f "$SCRIPT_DIR/start.sh" ]; then
  open -a Terminal "$SCRIPT_DIR/start.sh"

  # Wait for frontend to come up, then open with new-task action
  for i in $(seq 1 30); do
    if /usr/bin/curl -s --max-time 2 "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
      sleep 1
      open -a "Google Chrome" "$NEW_TASK_URL"
      exit 0
    fi
    sleep 1
  done
fi
