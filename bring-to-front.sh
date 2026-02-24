#!/bin/bash
# ──────────────────────────────────────────────
# bring-to-front.sh — Raise the TaskManager window
# Finds the Chrome/Edge --app window for TaskManager and brings it to focus.
#
# Usage:
#   ./bring-to-front.sh
#
# Bind to a global keyboard shortcut via:
#   System Settings → Keyboard → Keyboard Shortcuts → Services
#   (see the Automator Quick Action installed alongside this script)
# ──────────────────────────────────────────────

osascript <<'APPLESCRIPT'
-- Try each Chromium-based browser that might be hosting the app window
set browserList to {"Google Chrome", "Google Chrome Canary", "Chromium", "Microsoft Edge", "Brave Browser"}
set found to false

repeat with browserName in browserList
  try
    tell application "System Events"
      if exists (process (browserName as text)) then
        tell process (browserName as text)
          repeat with w in windows
            set winTitle to name of w
            -- The --app window title matches the <title> tag of the page
            if winTitle contains "TaskManager" or winTitle contains "localhost:5173" then
              -- Bring this specific window to front
              perform action "AXRaise" of w
              set frontmost to true
              set found to true
              exit repeat
            end if
          end repeat
        end tell
        if found then exit repeat
      end if
    end tell
  end try
end repeat

if not found then
  -- Fallback: if the window wasn't found, the app may not be running
  display notification "TaskManager window not found. Is the app running?" with title "TaskManager"
end if
APPLESCRIPT
