#!/bin/bash
# ──────────────────────────────────────────────
# bring-to-front.sh — Raise the TaskManager window
# Finds the Chrome/Edge --app window for TaskManager and brings it to focus.
# Uses the browser's native AppleScript dictionary (no Accessibility permissions needed).
#
# Usage:
#   ./bring-to-front.sh
# ──────────────────────────────────────────────

FRONTEND_PORT=5173
URL="localhost:$FRONTEND_PORT"

osascript <<APPLESCRIPT
-- Try each Chromium-based browser using its native AppleScript dictionary.
-- This does NOT require Accessibility permissions, unlike the System Events approach.
set browserList to {"Google Chrome", "Google Chrome Canary", "Chromium", "Microsoft Edge", "Brave Browser"}
set found to false

repeat with browserName in browserList
  try
    if application (browserName as text) is running then
      tell application (browserName as text)
        set windowList to every window
        repeat with aWindow in windowList
          set tabList to every tab of aWindow
          repeat with aTab in tabList
            if URL of aTab contains "$URL" then
              -- Focus this tab and bring its window to front
              set active tab index of aWindow to (index of aTab)
              set index of aWindow to 1
              activate
              set found to true
              exit repeat
            end if
          end repeat
          if found then exit repeat
        end repeat
      end tell
      if found then exit repeat
    end if
  end try
end repeat

if not found then
  -- Fallback: open the URL (starts the app in a new tab/window)
  do shell script "open 'http://$URL'"
end if
APPLESCRIPT
