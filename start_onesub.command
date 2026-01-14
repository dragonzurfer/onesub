#!/bin/bash

# Get the directory where this script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Function to kill child processes on exit
cleanup() {
    echo "Stopping servers..."
    if [ -n "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
    fi
    exit
}

# Trap exit signals to run cleanup
trap cleanup EXIT INT TERM

echo "Starting OneSub..."

# Start Backend
echo "Starting Backend (Go)..."
cd "$DIR/src/onesub-app/backend"
go run . &
BACKEND_PID=$!

# Start Frontend
echo "Starting Frontend (Next.js)..."
cd "$DIR/src/onesub-app"
# Using npm run dev. If you use pnpm, change this line to 'pnpm dev'
npm run dev &
FRONTEND_PID=$!

# Wait for servers to initialize (adjust seconds if needed)
echo "Waiting for servers to launch..."
sleep 5

# Open in default browser
echo "Opening http://localhost:3000 ..."
open "http://localhost:3000"

# Keep script running
echo ""
echo "==================================================="
echo "  OneSub is running!"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  (Port defined in Go app)"
echo ""
echo "  Press any key or close this window to stop."
echo "==================================================="
read -n 1 -s -r -p ""

# Cleanup handled by trap
