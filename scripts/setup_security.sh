#!/bin/bash
set -e

echo "=========================================================="
echo "🛡️  Splotch Automated Security Provisioning (CrowdSec + Fail2ban)"
echo "=========================================================="

if [ "$EUID" -ne 0 ]; then
  echo "❌ Error: Please run as root or with sudo:"
  echo "  sudo ./scripts/setup_security.sh"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ------------------------------------------------------------
# 1. FAIL2BAN SETUP
# ------------------------------------------------------------
echo ""
echo "📦 [1/3] Configuring Fail2ban..."
if ! command -v fail2ban-client &> /dev/null; then
  echo "Installing fail2ban package..."
  apt-get update -y
  apt-get install -y fail2ban
fi

mkdir -p /etc/fail2ban/filter.d /etc/fail2ban/jail.d
cp "${REPO_ROOT}/server/fail2ban/filter.d/splotch.conf" /etc/fail2ban/filter.d/splotch.conf
cp "${REPO_ROOT}/server/fail2ban/jail.d/splotch.local" /etc/fail2ban/jail.d/splotch.local
chmod 644 /etc/fail2ban/filter.d/splotch.conf /etc/fail2ban/jail.d/splotch.local

systemctl enable fail2ban
systemctl restart fail2ban
echo "✅ Fail2ban jail 'splotch' is active."

# ------------------------------------------------------------
# 2. CROWDSEC SETUP
# ------------------------------------------------------------
echo ""
echo "🛡️  [2/3] Configuring CrowdSec & Community Threat Intelligence..."
if ! command -v cscli &> /dev/null; then
  echo "Adding official CrowdSec repository..."
  curl -s https://install.crowdsec.net | sh
  apt-get update -y
  apt-get install -y crowdsec crowdsec-firewall-bouncer-nftables
fi

mkdir -p /etc/crowdsec/acquis.d /etc/crowdsec/parsers/s01-parse /etc/crowdsec/scenarios
cp "${REPO_ROOT}/server/crowdsec/acquis.d/splotch.yaml" /etc/crowdsec/acquis.d/splotch.yaml
cp "${REPO_ROOT}/server/crowdsec/parsers/splotch-logs.yaml" /etc/crowdsec/parsers/s01-parse/splotch-logs.yaml
cp "${REPO_ROOT}/server/crowdsec/scenarios/splotch-attacks.yaml" /etc/crowdsec/scenarios/splotch-attacks.yaml

cscli collections install crowdsecurity/linux --force || true
cscli collections install crowdsecurity/sshd --force || true

systemctl enable crowdsec
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
echo "✅ CrowdSec engine and nftables firewall bouncer are active."

# ------------------------------------------------------------
# 3. CONFIGURE SUDOERS FOR AUTOMATED MAINTENANCE
# ------------------------------------------------------------
echo ""
echo "🔑 [3/3] Setting up passwordless sudoers for service operations..."
SUDOERS_FILE="/etc/sudoers.d/splotch"
cat << 'EOF' > "$SUDOERS_FILE"
# Allow loki user to manage splotch and security services non-interactively
loki ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart splotch.service, /usr/bin/systemctl reload splotch.service, /usr/bin/systemctl status splotch.service
loki ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart fail2ban, /usr/bin/systemctl reload fail2ban, /usr/bin/fail2ban-client *
loki ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart crowdsec, /usr/bin/systemctl reload crowdsec, /usr/bin/cscli *
EOF
chmod 0440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE"
echo "✅ Sudoers configured at $SUDOERS_FILE."

echo ""
echo "=========================================================="
echo "🎉 All Security Systems Fully Automated & Active!"
echo "   - Fail2ban: Monitoring splotch.service"
echo "   - CrowdSec: Global Threat Intelligence + Splotch Scenarios Active"
echo "   - Service Restarts: Can now run fully unattended via ./restart.sh"
echo "=========================================================="
