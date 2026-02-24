#!/bin/bash
# ──────────────────────────────────────────────
# TaskManager — one-click launcher
# Starts backend + frontend, opens the browser
# ──────────────────────────────────────────────

# Resolve the project root (where this script lives)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

BACKEND_PORT=3001
FRONTEND_PORT=5173
LOG_DIR="$SCRIPT_DIR/.logs"
mkdir -p "$LOG_DIR"

# ── Cleanup on exit ──────────────────────────
cleanup() {
  echo ""
  echo "Shutting down TaskManager..."
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
  wait 2>/dev/null
  echo "Done."
}
trap cleanup EXIT INT TERM

# ── Check for node ───────────────────────────
if ! command -v node &>/dev/null; then
  echo "Error: node is not installed. Install Node.js first."
  echo "  brew install node"
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "Error: npm is not installed."
  exit 1
fi

# ── Install deps if needed ───────────────────
if [ ! -d "$SCRIPT_DIR/backend/node_modules" ]; then
  echo "Installing backend dependencies..."
  npm install --prefix "$SCRIPT_DIR/backend"
fi
if [ ! -d "$SCRIPT_DIR/frontend/node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm install --legacy-peer-deps --prefix "$SCRIPT_DIR/frontend"
fi

# ── Kill anything already on our ports ───────
kill_port() {
  local port=$1
  local pid
  pid=$(lsof -ti :"$port" 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "Port $port in use (PID $pid), stopping it..."
    kill "$pid" 2>/dev/null
    sleep 1
  fi
}
kill_port $BACKEND_PORT
kill_port $FRONTEND_PORT

# ── Start backend ────────────────────────────
echo "Starting backend on port $BACKEND_PORT..."
npm run dev --prefix "$SCRIPT_DIR/backend" > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# ── Start frontend ───────────────────────────
echo "Starting frontend on port $FRONTEND_PORT..."
npm run dev --prefix "$SCRIPT_DIR/frontend" > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# ── Wait for backend health check ────────────
echo "Waiting for servers to start..."
for i in $(seq 1 30); do
  if curl -s "http://localhost:$BACKEND_PORT/api/health" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ── Wait for frontend ────────────────────────
for i in $(seq 1 30); do
  if curl -s "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ── Open as standalone app window ────────────
URL="http://localhost:$FRONTEND_PORT"
echo ""
echo "TaskManager is running at $URL"
echo "Press Ctrl+C to stop."
echo ""

# Try to open in a standalone app window (no browser chrome)
if [ -d "/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" --args --app="$URL"
elif [ -d "/Applications/Google Chrome Canary.app" ]; then
  open -a "Google Chrome Canary" --args --app="$URL"
elif [ -d "/Applications/Chromium.app" ]; then
  open -a "Chromium" --args --app="$URL"
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  open -a "Microsoft Edge" --args --app="$URL"
elif [ -d "/Applications/Brave Browser.app" ]; then
  open -a "Brave Browser" --args --app="$URL"
elif command -v open &>/dev/null; then
  # Fallback: regular browser
  echo "(Install Chrome or Edge for a native app window experience)"
  open "$URL"
elif command -v xdg-open &>/dev/null; then
  xdg-open "$URL"
fi

# ── Keep running until Ctrl+C ────────────────
wait
