#!/bin/bash
# ──────────────────────────────────────────────
# new-task.sh — Open TaskManager and start the New Task flow
#
# If servers are running: navigates to ?action=new-task and brings to front
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

# ── If servers are running, navigate to new-task and bring to front ──
if /usr/bin/curl -s --max-time 2 "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then

  # Mirror the exact pattern from the launcher (which works for bring-to-front)
  # but set the URL to include ?action=new-task before activating
  RESULT=$(osascript <<EOF 2>&1
tell application "Google Chrome"
    repeat with w from 1 to (count of windows)
        repeat with t from 1 to (count of tabs of window w)
            if URL of tab t of window w contains "$TARGET_URL" then
                set active tab index of window w to t
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
      ;; # Tab found, navigated, and focused
    *)
      # Fallback — open URL directly
      open "http://$NEW_TASK_URL"
      ;;
  esac

  exit 0
fi

# ── Servers not running — start them, then open with action param ──
if [ -f "$SCRIPT_DIR/start.sh" ]; then
  open -a Terminal "$SCRIPT_DIR/start.sh"

  # Wait for frontend to come up, then open with new-task action
  for i in $(seq 1 30); do
    if /usr/bin/curl -s --max-time 2 "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
      sleep 1
      osascript -e "tell application \"Google Chrome\" to open location \"$NEW_TASK_URL\"" -e "tell application \"Google Chrome\" to activate"
      exit 0
    fi
    sleep 1
  done
fi
