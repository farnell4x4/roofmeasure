#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
READY_URL="${READY_URL:-http://localhost:3000}"
APP_URL="${APP_URL:-http://localhost:3000/mapkit-test}"
LOG_FILE="${TMPDIR:-/tmp}/roofmeasure-dev.log"
PID_FILE="${TMPDIR:-/tmp}/roofmeasure-dev.pid"

cd "$ROOT_DIR"

if [ -f "$PID_FILE" ]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${EXISTING_PID:-}" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    kill "$EXISTING_PID" 2>/dev/null || true
    sleep 1
  fi
fi

PIDS="$(pgrep -f "next dev|npm run dev" 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  echo "$PIDS" | while IFS= read -r pid; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  sleep 1
fi

rm -f "$PID_FILE"
: >"$LOG_FILE"

npm run dev >"$LOG_FILE" 2>&1 &
DEV_PID=$!
echo "$DEV_PID" >"$PID_FILE"

ATTEMPTS=0
until curl -I "$READY_URL" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo "RoofMeasure dev server exited before becoming ready. Check $LOG_FILE"
    exit 1
  fi
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

echo "RoofMeasure restarted in the VS Code terminal and Safari refreshed at $APP_URL"
echo "Streaming dev server logs from $LOG_FILE"

tail -f "$LOG_FILE"
