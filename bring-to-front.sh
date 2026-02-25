#!/bin/bash
# ──────────────────────────────────────────────
# bring-to-front.sh — Raise the TaskManager window
#
# Finds the Chrome window titled "TaskManager" and brings it to front.
# Returns exit code 0 if found, 1 if not found.
# ──────────────────────────────────────────────

RESULT=$(osascript <<'APPLESCRIPT' 2>&1
tell application "Google Chrome"
    repeat with w in windows
        if name of w contains "TaskManager" then
            set index of w to 1
            delay 0.5
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
else
  exit 1
fi
