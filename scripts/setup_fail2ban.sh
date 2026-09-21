#!/bin/bash
set -e

echo "=== Setting up Fail2ban for Splotch Server ==="

if [ "$EUID" -ne 0 ]; then
  echo "Error: Please run as root or with sudo:"
  echo "  sudo ./scripts/setup_fail2ban.sh"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "1. Installing fail2ban filter config..."
cp "${REPO_ROOT}/server/fail2ban/filter.d/splotch.conf" /etc/fail2ban/filter.d/splotch.conf
chmod 644 /etc/fail2ban/filter.d/splotch.conf

echo "2. Installing fail2ban jail config..."
cp "${REPO_ROOT}/server/fail2ban/jail.d/splotch.local" /etc/fail2ban/jail.d/splotch.local
chmod 644 /etc/fail2ban/jail.d/splotch.local

echo "3. Verifying filter syntax..."
fail2ban-regex "{\"level\":\"warn\",\"message\":\"[SECURITY] Hostile attempt from IP 192.168.1.50: Honeypot Trap Triggered on GET /.env\"}" /etc/fail2ban/filter.d/splotch.conf

echo "4. Reloading fail2ban..."
fail2ban-client reload

echo "5. Checking splotch jail status..."
fail2ban-client status splotch

echo "=== Fail2ban splotch jail successfully activated! ==="
