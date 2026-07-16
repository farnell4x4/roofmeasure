#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
APP_URL="${APP_URL:-http://127.0.0.1:3000}"
LOG_FILE="${TMPDIR:-/tmp}/roofmeasure-dev.log"
TERMINAL_TITLE="RoofMeasure Dev Server"

cd "$ROOT_DIR"

PIDS="$(pgrep -f "next dev|npm run dev" || true)"
if [ -n "$PIDS" ]; then
  echo "$PIDS" | while IFS= read -r pid; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  sleep 1
fi

# Start the dev server in Terminal so VS Code does not reap the process when the task exits.
osascript <<EOF
tell application "Terminal"
  activate
  set launchCommand to "printf '\\\\e]1;${TERMINAL_TITLE}\\\\a'; cd " & quoted form of "$ROOT_DIR" & " && npm run dev 2>&1 | tee " & quoted form of "$LOG_FILE"
  do script launchCommand
end tell
EOF

ATTEMPTS=0
until curl -I "$APP_URL" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge 60 ]; then
    echo "RoofMeasure dev server did not become ready. Check $LOG_FILE"
    exit 1
  fi
  sleep 1
done

osascript <<EOF
set targetUrl to "$APP_URL"
tell application "Safari"
  activate
  if (count of windows) is 0 then
    make new document with properties {URL:targetUrl}
    return
  end if

  set matchedTab to missing value
  set matchedWindow to missing value

  repeat with currentWindow in windows
    repeat with currentTab in tabs of currentWindow
      set currentUrl to URL of currentTab
      if currentUrl is not missing value and (currentUrl contains targetUrl or currentUrl contains "http://localhost:3000") then
        set matchedTab to currentTab
        set matchedWindow to currentWindow
        exit repeat
      end if
    end repeat
    if matchedTab is not missing value then
      exit repeat
    end if
  end repeat

  if matchedTab is missing value then
    tell window 1
      set current tab to (make new tab with properties {URL:targetUrl})
    end tell
  else
    set current tab of matchedWindow to matchedTab
    set index of matchedWindow to 1
    tell matchedTab to set URL to targetUrl
  end if
end tell
EOF

echo "RoofMeasure restarted and Safari refreshed at $APP_URL"
