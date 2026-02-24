#!/bin/bash
# ──────────────────────────────────────────────
# bring-to-front.sh — Raise the TaskManager window
#
# Uses Chrome's AppleScript dictionary to find the exact tab by URL.
# Falls back to `open` if AppleScript fails (e.g. permissions not granted).
# ──────────────────────────────────────────────

FRONTEND_PORT=5173
TARGET_URL="localhost:$FRONTEND_PORT"

# Try AppleScript to focus the exact tab
RESULT=$(osascript <<EOF 2>&1
tell application "Google Chrome"
    repeat with w from 1 to (count of windows)
        repeat with t from 1 to (count of tabs of window w)
            if URL of tab t of window w contains "$TARGET_URL" then
                set active tab index of window w to t
                set index of window w to 1
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
    ;; # Tab found and focused
  "not_found")
    # Chrome running but no matching tab — open one
    open -a "Google Chrome" "http://$TARGET_URL"
    ;;
  *)
    # AppleScript failed (permissions denied or Chrome not running)
    open "http://$TARGET_URL"
    ;;
esac
