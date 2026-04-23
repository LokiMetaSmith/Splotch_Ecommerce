#!/bin/bash

echo "Installing root dependencies..."
pnpm install

echo "Installing server dependencies..."
(cd server && pnpm install)

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
