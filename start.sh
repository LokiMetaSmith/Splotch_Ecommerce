#!/bin/bash

# Check if user wants to restart production service
if [[ "$1" == "--prod" ]] || [[ "$1" == "--restart" ]] || [[ "$1" == "restart" ]]; then
    shift
    exec "$(dirname "$0")/restart.sh" "$@"
fi

# If production systemd service is active, inform user
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet splotch.service 2>/dev/null; then
    echo "ℹ️  Notice: Production 'splotch.service' is running."
    echo "   To rebuild & restart the live website, use: ./restart.sh (or ./start.sh --prod)"
    echo "   Continuing with local development server in 3 seconds..."
    sleep 3
fi

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null
then
    echo "Error: pnpm is not installed."
    echo "Please install it by running: npm install -g pnpm"
    exit 1
fi

echo "Installing root dependencies..."
HUSKY=0 pnpm install

echo "Installing server dependencies..."
(cd server && HUSKY=0 pnpm install)

echo "Starting backend server..."
(cd server && pnpm start) &
BACKEND_PID=$!

echo "Starting frontend dev server..."
pnpm dev &
FRONTEND_PID=$!

# Trap SIGINT and SIGTERM to kill the child processes cleanly
trap 'echo "Stopping servers..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit' SIGINT SIGTERM

echo "Servers started. Press Ctrl+C to stop."

# Wait for both processes
wait $BACKEND_PID
wait $FRONTEND_PID
