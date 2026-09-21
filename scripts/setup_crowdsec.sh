#!/bin/bash
set -e

echo "=============================================="
echo "🛡️ Installing and Configuring CrowdSec for Splotch"
echo "=============================================="

if [ "$EUID" -ne 0 ]; then
  echo "Error: Please run as root or with sudo:"
  echo "  sudo ./scripts/setup_crowdsec.sh"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Step 1: Install CrowdSec repository if not already installed
if ! command -v cscli &> /dev/null; then
  echo "1. Adding official CrowdSec repository..."
  curl -s https://install.crowdsec.net | sh

  echo "2. Installing crowdsec engine and nftables firewall bouncer..."
  apt-get update
  apt-get install -y crowdsec crowdsec-firewall-bouncer-nftables
else
  echo "1. CrowdSec is already installed ($(cscli version 2>&1 | head -n 1))."
fi

# Step 2: Install custom Splotch acquisition, parser, and scenario
echo "3. Installing Splotch log acquisition..."
mkdir -p /etc/crowdsec/acquis.d
cp "${REPO_ROOT}/server/crowdsec/acquis.d/splotch.yaml" /etc/crowdsec/acquis.d/splotch.yaml

echo "4. Installing Splotch parser..."
mkdir -p /etc/crowdsec/parsers/s01-parse
cp "${REPO_ROOT}/server/crowdsec/parsers/splotch-logs.yaml" /etc/crowdsec/parsers/s01-parse/splotch-logs.yaml

echo "5. Installing Splotch scenario..."
mkdir -p /etc/crowdsec/scenarios
cp "${REPO_ROOT}/server/crowdsec/scenarios/splotch-attacks.yaml" /etc/crowdsec/scenarios/splotch-attacks.yaml

# Step 3: Install standard OS collections (SSH, Linux)
echo "6. Ensuring base collections are installed..."
cscli collections install crowdsecurity/linux --force || true
cscli collections install crowdsecurity/sshd --force || true

# Step 4: Restart and verify CrowdSec
echo "7. Restarting CrowdSec service..."
systemctl restart crowdsec

# Ensure firewall bouncer has a valid API key registered with LAPI
if [ -f /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml ]; then
  CURRENT_KEY=$(grep -E "^api_key:" /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml | awk '{print $2}' || true)
  if [ -z "$CURRENT_KEY" ] || [ "$CURRENT_KEY" = "<API_KEY>" ] || [ "$CURRENT_KEY" = "null" ]; then
    echo "Registering firewall bouncer API key with CrowdSec LAPI..."
    cscli bouncers delete firewall-bouncer 2>/dev/null || true
    API_KEY=$(cscli bouncers add firewall-bouncer -o raw)
    sed -i "s/^api_key:.*/api_key: ${API_KEY}/" /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml
  fi
  systemctl enable crowdsec-firewall-bouncer || true
  systemctl restart crowdsec-firewall-bouncer || true
fi

echo "8. Verifying CrowdSec status..."
cscli metrics

echo "=============================================="
echo "✅ CrowdSec successfully installed and running!"
echo "Global Community Threat Intelligence Blocklist is ACTIVE."
echo "Custom Splotch honeypot/intrusion parser is ACTIVE."
echo ""
echo "Useful commands:"
echo "  cscli decisions list       # View currently banned IPs"
echo "  cscli alerts list          # View recent security alerts"
echo "  cscli metrics              # View real-time parsing statistics"
echo "=============================================="
