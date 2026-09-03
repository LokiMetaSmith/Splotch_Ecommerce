#!/bin/bash

# ==============================================================================
# Cloudflare Tunnel Deployment Script
# ==============================================================================
#
# Description:
# Automates the setup of a free Cloudflare Tunnel (cloudflared).
# This is a modern, free alternative to the Reverse SSH Tunnel setup. It exposes
# your local Splotch server to the internet securely without opening router ports,
# and automatically provides DDoS protection and SSL/HTTPS via Cloudflare.
#
# Prerequisites:
# - A free Cloudflare account
# - A domain name with its DNS managed by Cloudflare
# - Run this script on the server hosting the Splotch app (e.g., your home server)
#
# Usage:
# sudo bash ./scripts/deploy-cloudflare-tunnel.sh

set -e

echo "=========================================================="
echo " Cloudflare Tunnel Setup for Splotch Print Shop"
echo "=========================================================="
echo

if [ "$EUID" -ne 0 ]; then
  echo "Error: Please run this script as root (e.g., sudo bash ./scripts/deploy-cloudflare-tunnel.sh)"
  exit 1
fi

APP_PORT=3000 # The default port the Splotch backend runs on

# 1. Install cloudflared
if ! command -v cloudflared &> /dev/null; then
    echo "[1/6] Installing cloudflared..."
    curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    dpkg -i cloudflared.deb
    rm cloudflared.deb
else
    echo "[1/6] cloudflared is already installed. Updating..."
    cloudflared update || echo "Already up to date."
fi

# 2. Login
echo
echo "[2/6] Authenticating with Cloudflare..."
echo "A link will appear below. Open it in your browser and log in to Cloudflare."
echo "Select the domain you want to use for the Print Shop."
cloudflared tunnel login

# 3. Create Tunnel
echo
echo "[3/6] Creating Tunnel..."
read -p "Enter a name for this tunnel (e.g., splotch-home-server): " TUNNEL_NAME
cloudflared tunnel create "$TUNNEL_NAME"

# 4. Route DNS
echo
echo "[4/6] Routing DNS..."
read -p "Enter the full domain/subdomain to route to this server (e.g., shop.yourdomain.com): " TUNNEL_DOMAIN
cloudflared tunnel route dns "$TUNNEL_NAME" "$TUNNEL_DOMAIN"

# 5. Create config.yml
echo
echo "[5/6] Creating Configuration..."
# Extract the UUID of the newly created tunnel
TUNNEL_UUID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
CRED_FILE="/root/.cloudflared/${TUNNEL_UUID}.json"

mkdir -p /etc/cloudflared
cat << EOF > /etc/cloudflared/config.yml
tunnel: $TUNNEL_UUID
credentials-file: $CRED_FILE

ingress:
  - hostname: $TUNNEL_DOMAIN
    service: http://localhost:$APP_PORT
  - service: http_status:404
EOF

# 6. Install and Start Service
echo
echo "[6/6] Installing Cloudflare Tunnel as a system service..."
cloudflared service install || echo "Service already installed, skipping..."
systemctl restart cloudflared

echo
echo "=========================================================="
echo " Success! Your Cloudflare Tunnel is running in the background."
echo " Traffic to https://$TUNNEL_DOMAIN is now securely routed"
echo " to localhost:$APP_PORT on this machine."
echo ""
echo " Note: You do not need to open any ports on your home router!"
echo "=========================================================="
