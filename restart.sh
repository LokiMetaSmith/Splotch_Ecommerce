#!/usr/bin/env bash
# ==============================================================================
# Splotch Website Restart Script
# Automates: git pull (optional), building frontend assets, restarting the
# systemd service (or process respawn), and validating server health.
# ==============================================================================

set -e

# Change to repository root
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

DO_PULL=false
DO_INSTALL=false
SKIP_INSTALL=false
SKIP_BUILD=false
SYNC_SECURITY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--pull)
      DO_PULL=true
      shift
      ;;
    -i|--install)
      DO_INSTALL=true
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    -s|--security|--sync-security)
      SYNC_SECURITY=true
      shift
      ;;
    -h|--help)
      echo "Usage: ./restart.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  -p, --pull        Pull latest changes from git and install dependencies"
      echo "  -i, --install     Install dependencies (pnpm/npm) before building"
      echo "  --skip-install    Skip installing dependencies"
      echo "  --skip-build      Skip building frontend assets (npm/pnpm run build)"
      echo "  -s, --security    Sync CrowdSec and Fail2ban security configurations"
      echo "  -h, --help        Show this help message"
      echo ""
      echo "Examples:"
      echo "  ./restart.sh                  # Rebuild frontend & restart service"
      echo "  ./restart.sh --pull           # Pull git, install dependencies, rebuild frontend & restart service"
      echo "  ./restart.sh --install        # Install dependencies, rebuild frontend & restart service"
      echo "  ./restart.sh --pull --security # Full update including security policies"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use ./restart.sh --help for usage information."
      exit 1
      ;;
  esac
done

echo "=================================================="
echo "🚀 Restarting Splotch Website..."
echo "📁 Directory: $REPO_DIR"
echo "=================================================="

# 1. Git Pull (if requested)
if [ "$DO_PULL" = true ]; then
  echo ""
  echo "📥 [1/5] Pulling latest changes from git..."
  git pull
else
  echo ""
  echo "ℹ️  [1/5] Skipping git pull (use './restart.sh --pull' to pull latest changes)."
fi

# 2. Dependency Installation
if [ "$SKIP_INSTALL" = true ]; then
  echo ""
  echo "⏭️  [2/5] Skipping dependency installation as requested."
elif [ "$DO_PULL" = true ] || [ "$DO_INSTALL" = true ] || [ ! -d "node_modules" ] || [ ! -d "server/node_modules" ]; then
  echo ""
  echo "📦 [2/5] Installing dependencies..."
  if command -v pnpm >/dev/null 2>&1; then
    HUSKY=0 pnpm install
  elif command -v npm >/dev/null 2>&1; then
    npm install
    if [ -d "server" ] && [ -f "server/package.json" ]; then
      (cd server && npm install)
    fi
  else
    echo "❌ Error: Neither pnpm nor npm was found to install dependencies."
    exit 1
  fi
else
  echo ""
  echo "ℹ️  [2/5] Dependencies are intact (use '--install' or '--pull' to update)."
fi

# 3. Build Frontend Assets
if [ "$SKIP_BUILD" = true ]; then
  echo ""
  echo "⏭️  [3/5] Skipping frontend build as requested."
else
  echo ""
  echo "🔨 [3/5] Building frontend assets (Vite)..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm run build
  elif command -v npm >/dev/null 2>&1; then
    npm run build
  else
    echo "❌ Error: Neither pnpm nor npm was found to build frontend."
    exit 1
  fi
fi

# 3.5. Security Policies Sync (Fail2ban & CrowdSec)
if [ "$SYNC_SECURITY" = true ] || { [ -f "./scripts/setup_security.sh" ] && sudo -n true 2>/dev/null && [ ! -f "/etc/fail2ban/jail.d/splotch.local" ]; }; then
  echo ""
  echo "🛡️  [3.5/5] Syncing security policies (Fail2ban & CrowdSec)..."
  if sudo -n true 2>/dev/null; then
    sudo bash ./scripts/setup_security.sh || true
  elif [ -t 0 ]; then
    sudo bash ./scripts/setup_security.sh || true
  else
    echo "⚠️ Sudo password required for security sync; run 'sudo ./scripts/setup_security.sh' manually."
  fi
fi

# 4. Restart Service
echo ""
echo "🔄 [4/5] Restarting Splotch backend..."

RESTART_SUCCESS=false

# Case A: If systemctl is available and sudo can run without password
if command -v systemctl >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  echo "👉 Executing: sudo systemctl restart splotch.service"
  sudo systemctl restart splotch.service
  RESTART_SUCCESS=true

# Case B: Interactive terminal where sudo can prompt for password
elif [ -t 0 ] && command -v sudo >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1; then
  echo "👉 Prompting for sudo to restart splotch.service..."
  if sudo systemctl restart splotch.service; then
    RESTART_SUCCESS=true
  fi
fi

# Case C: Fallback to process respawn via systemd's Restart=always
if [ "$RESTART_SUCCESS" = false ]; then
  NODE_PID=$(pgrep -u "$USER" -f "node index.js" 2>/dev/null || true)
  if [ -n "$NODE_PID" ]; then
    echo "👉 Signaling node process (PID $NODE_PID) to terminate; systemd will auto-restart it..."
    kill "$NODE_PID" || true
    RESTART_SUCCESS=true
  else
    echo "⚠️ No running 'node index.js' process found for user $USER."
    if command -v systemctl >/dev/null 2>&1; then
      sudo systemctl restart splotch.service 2>/dev/null || true
    fi
  fi
fi

# 5. Verification & Health Check
echo ""
echo "🩺 [5/5] Verifying server health..."

HEALTHY=false
for i in {1..15}; do
  sleep 1
  HTTP_STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/config 2>/dev/null || true)
  if [ "$HTTP_STATUS" = "200" ]; then
    HEALTHY=true
    break
  fi
  printf "."
done
echo ""

if [ "$HEALTHY" = true ]; then
  echo "=================================================="
  echo "✅ Splotch website is LIVE and healthy! (HTTP $HTTP_STATUS)"
  echo "🌐 Local: http://localhost:3000"
  echo "=================================================="
else
  echo "=================================================="
  echo "⚠️ Warning: Server did not respond with 200 within 15 seconds."
  echo "Check systemd logs with: journalctl -u splotch.service -n 30 --no-pager"
  echo "=================================================="
  exit 1
fi
