#!/bin/bash

# ==============================================================================
# Proxmox NAT Gateway Deployment Script
# ==============================================================================
#
# Description:
# This script deploys a specialized NAT Gateway VM on Proxmox.
# It configures two network interfaces (WAN and LAN) and sets up
# a firewall/NAT via cloud-init.
#
# Prerequisites:
# 1. Run as root on Proxmox VE.
# 2. Cloud-init template exists (default ID 9000).
# 3. Two bridges usually required (e.g., vmbr0 for WAN, vmbr1 for LAN).
#
# Usage:
# sudo ./scripts/deploy-nat-gateway.sh [new-vmid] [new-vm-name]
#
# ==============================================================================

set -e
set -u
set -o pipefail

# --- Configuration ---

TEMPLATE_VMID="9000"
STORAGE_POOL="local-lvm"
# Path to the template cloud-config. We will inject values into a copy of this.
CLOUD_CONFIG_TEMPLATE="docs/nat-gateway-cloud-config.yml"

# --- Dynamic Configuration ---

NEW_VMID="${1:-9100}" # Different default range for infrastructure
NEW_VM_NAME="${2:-nat-gateway}"

# --- Network Defaults ---
WAN_BRIDGE="vmbr0"
LAN_BRIDGE="vmbr1"

# --- Script Logic ---

echo "-------------------------------------"
echo "  NAT Gateway Deployment to Proxmox  "
echo "-------------------------------------"
echo

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: This script must be run as root." >&2
  exit 1
fi

if ! command -v qm &> /dev/null; then
    echo "Error: 'qm' command not found. Run this on the Proxmox host."
    exit 1
fi

if [ ! -f "$CLOUD_CONFIG_TEMPLATE" ]; then
    echo "Error: Cloud-config template not found at '$CLOUD_CONFIG_TEMPLATE'."
    exit 1
fi

if qm status "$NEW_VMID" >/dev/null 2>&1; then
    echo "Error: A VM with ID $NEW_VMID already exists."
    exit 1
fi

echo "Configuration:"
echo "  - Template ID:    $TEMPLATE_VMID"
echo "  - Gateway VM ID:  $NEW_VMID"
echo "  - VM Name:        $NEW_VM_NAME"
echo

# --- Network Configuration ---

echo "Network Configuration:"
echo "----------------------"

# WAN Setup
read -p "WAN Bridge (default: $WAN_BRIDGE): " INPUT_WAN_BRIDGE
WAN_BRIDGE="${INPUT_WAN_BRIDGE:-$WAN_BRIDGE}"

read -p "WAN IP (CIDR, e.g., 192.168.1.50/24): " WAN_IP
read -p "WAN Gateway (e.g., 192.168.1.1): " WAN_GW

if [ -z "$WAN_IP" ] || [ -z "$WAN_GW" ]; then
    echo "Error: WAN IP and Gateway are required."
    exit 1
fi

echo
# LAN Setup
read -p "LAN Bridge (default: $LAN_BRIDGE): " INPUT_LAN_BRIDGE
LAN_BRIDGE="${INPUT_LAN_BRIDGE:-$LAN_BRIDGE}"

read -p "LAN IP (CIDR, e.g., 10.0.0.1/24): " LAN_IP
# No gateway for LAN interface on the router itself

if [ -z "$LAN_IP" ]; then
    echo "Error: LAN IP is required."
    exit 1
fi

echo
# --- SSH Key Handling ---
SSH_KEY=""
# Try to detect root's SSH key or user's key if sudo
POSSIBLE_KEYS=(
  "/root/.ssh/id_rsa.pub"
  "/root/.ssh/id_ed25519.pub"
  "${HOME}/.ssh/id_rsa.pub"
  "${HOME}/.ssh/id_ed25519.pub"
)

for key in "${POSSIBLE_KEYS[@]}"; do
    if [ -f "$key" ]; then
        SSH_KEY=$(cat "$key")
        echo "Found SSH Key: $key"
        break
    fi
done

if [ -z "$SSH_KEY" ]; then
    echo "No local SSH key found."
    read -p "Paste your public SSH key (starts with 'ssh-rsa' or similar): " SSH_KEY_INPUT
    if [ -z "$SSH_KEY_INPUT" ]; then
        echo "Error: SSH Key is required to access the VM."
        exit 1
    fi
    SSH_KEY="$SSH_KEY_INPUT"
fi

echo
echo "Summary:"
echo "  WAN: $WAN_BRIDGE | $WAN_IP via $WAN_GW"
echo "  LAN: $LAN_BRIDGE | $LAN_IP"
echo "  SSH: Key provided"
echo

read -p "Create NAT Gateway? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

# --- Execution ---

echo
echo "🚀 Cloning template..."
qm clone "$TEMPLATE_VMID" "$NEW_VMID" --name "$NEW_VM_NAME" --full

echo "⚙️  Configuring VM Hardware..."

# WAN Interface (net0)
qm set "$NEW_VMID" --net0 "virtio,bridge=$WAN_BRIDGE"
qm set "$NEW_VMID" --ipconfig0 "ip=$WAN_IP,gw=$WAN_GW"

# LAN Interface (net1)
qm set "$NEW_VMID" --net1 "virtio,bridge=$LAN_BRIDGE"
qm set "$NEW_VMID" --ipconfig1 "ip=$LAN_IP"

echo "📜 Generating Cloud-Init User Data..."

# Prepare the snippet
SNIPPET_STORAGE="local"
SNIPPET_NAME="user-data-${NEW_VMID}.yml"
SNIPPET_DIR="/var/lib/vz/snippets"
SNIPPET_PATH="$SNIPPET_DIR/$SNIPPET_NAME"

# Ensure snippet directory exists
mkdir -p "$SNIPPET_DIR"

# Read template and replace SSH key
# We use sed to replace the placeholder.
# NOTE: We must escape the SSH key for sed, or use a different delimiter.

# Escape forward slashes, backslashes, and ampersands in SSH key for sed
ESCAPED_SSH_KEY=$(echo "$SSH_KEY" | sed -e 's/\\/\\\\/g' -e 's/\//\\\//g' -e 's/&/\\\&/g')

sed "s/ssh-rsa AAAA... your_ssh_public_key/$ESCAPED_SSH_KEY/" "$CLOUD_CONFIG_TEMPLATE" > "$SNIPPET_PATH"

# Verify replacement success
if grep -q "ssh-rsa AAAA... your_ssh_public_key" "$SNIPPET_PATH"; then
    echo "Error: SSH Key replacement failed. The placeholder 'ssh-rsa AAAA... your_ssh_public_key' was not found or replaced in $SNIPPET_PATH."
    echo "Please check the template file: $CLOUD_CONFIG_TEMPLATE"
    # Clean up and exit
    rm "$SNIPPET_PATH"
    qm destroy "$NEW_VMID"
    exit 1
fi

echo "    Snippet created at: $SNIPPET_PATH"

qm set "$NEW_VMID" --cicustom "user=${SNIPPET_STORAGE}:snippets/${SNIPPET_NAME}"

echo "⚡️ Starting Gateway..."
qm start "$NEW_VMID"

echo
echo "✅ NAT Gateway '$NEW_VM_NAME' (ID: $NEW_VMID) deployed."
echo "   NOTE: The Cloud-Init snippet file ($SNIPPET_PATH) must persist for Proxmox configuration."
echo "   It will take a moment to install packages and configure the firewall."
echo "   Verify: ssh loki@${WAN_IP%/*}"
echo
