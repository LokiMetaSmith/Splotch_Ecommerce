#!/bin/bash

# ==============================================================================
# Proxmox VM Deployment Script
# ==============================================================================
#
# Description:
# This script automates the creation of a new VM on a Proxmox VE host.
# It clones a cloud-init-ready template, configures it with a user data
# file, sets network properties, and starts the VM.
#
# Prerequisites:
# 1. This script must be run directly on the Proxmox VE host as the 'root' user.
# 2. A cloud-init-ready VM template must exist on the Proxmox host.
#    (e.g., an Ubuntu Cloud image configured as a template).
# 3. The project repository (containing this script and the cloud-config file)
#    must be cloned onto the Proxmox host.
#
# Usage:
# sudo ./scripts/deploy-proxmox.sh [new-vmid] [new-vm-name]
#
#   - [new-vmid]: (Optional) The ID for the new VM. A default will be used if not set.
#   - [new-vm-name]: (Optional) The hostname for the new VM. A default will be used if not set.
#
# Example:
# sudo ./scripts/deploy-proxmox.sh 9001 print-shop-prod
#
# ==============================================================================

set -e
set -u
set -o pipefail

# --- Configuration ---
# IMPORTANT: Adjust these values to match your Proxmox environment.

# The ID of the VM template to clone.
# This template MUST be cloud-init enabled.
TEMPLATE_VMID="9000"

# The name of the storage pool where the new VM's disk will be created.
STORAGE_POOL="local-lvm"

# The network bridge for the new VM.
BRIDGE="vmbr0"

# Path to the cloud-config user data file.
# Assumes the script is run from the project root directory.
CLOUD_CONFIG_TEMPLATE="docs/proxmox-cloud-config.yml"

# --- Dynamic Configuration (from script arguments) ---

# The ID for the new VM. Falls back to a default if not provided.
NEW_VMID="${1:-9001}"

# The hostname for the new VM.
NEW_VM_NAME="${2:-print-shop-vm}"

# --- IP Configuration ---
# The script will prompt for these values.
IP_CONFIG=""
GATEWAY=""

# --- Script Logic ---

echo "-------------------------------------"
echo "  Print Shop Deployment to Proxmox   "
echo "-------------------------------------"
echo

# 1. Validate prerequisites
if [ "$(id -u)" -ne 0 ]; then
  echo "Error: This script must be run as root." >&2
  exit 1
fi

if ! command -v qm &> /dev/null; then
    echo "Error: 'qm' command not found. This script must be run on a Proxmox host."
    exit 1
fi

if [ ! -f "$CLOUD_CONFIG_TEMPLATE" ]; then
    echo "Error: Cloud-config template not found at '$CLOUD_CONFIG_TEMPLATE'."
    echo "Please ensure the file exists and the script is run from the project root."
    exit 1
fi

if ! qm status "$TEMPLATE_VMID" >/dev/null 2>&1; then
    echo "Error: Template VM with ID $TEMPLATE_VMID does not exist."
    exit 1
fi

if qm status "$NEW_VMID" >/dev/null 2>&1; then
    echo "Error: A VM with ID $NEW_VMID already exists."
    exit 1
fi

echo "Configuration:"
echo "  - Template VM ID: $TEMPLATE_VMID"
echo "  - New VM ID:      $NEW_VMID"
echo "  - New VM Name:    $NEW_VM_NAME"
echo "  - Storage Pool:   $STORAGE_POOL"
echo "  - Network Bridge: $BRIDGE"
echo "  - User Data File: $CLOUD_CONFIG_TEMPLATE"
echo

# 2. Get Network Configuration from User
echo "Please provide the network configuration for the new VM:"
read -p "  - IP Address (CIDR format, e.g., 192.168.1.50/24): " IP_CONFIG
read -p "  - Gateway (e.g., 192.168.1.1): " GATEWAY

if [ -z "$IP_CONFIG" ] || [ -z "$GATEWAY" ]; then
    echo "Error: IP Address and Gateway cannot be empty."
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

# 3. Confirm with the user before proceeding
read -p "Do you want to create this VM? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 1
fi

# 4. Create the VM
echo
echo "🚀 Cloning template $TEMPLATE_VMID to new VM $NEW_VMID..."
qm clone "$TEMPLATE_VMID" "$NEW_VMID" --name "$NEW_VM_NAME" --full

echo "⚙️  Configuring VM $NEW_VMID..."

# Proxmox's cicustom requires the user data to be on a storage snippet.
# We will create a temporary snippet for this deployment.
SNIPPET_STORAGE="local" # 'local' is the default storage for snippets
SNIPPET_NAME="user-data-${NEW_VMID}.yml"
SNIPPET_DIR="/var/lib/vz/snippets"
SNIPPET_PATH="$SNIPPET_DIR/$SNIPPET_NAME"

# Ensure snippet directory exists
mkdir -p "$SNIPPET_DIR"

echo "📜 Generating Cloud-Init User Data..."

# Escape forward slashes and ampersands in SSH key for sed
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

# Configure the VM to use the cloud-init user data from the snippet
qm set "$NEW_VMID" --cicustom "user=${SNIPPET_STORAGE}:snippets/${SNIPPET_NAME}"

# Configure network interface using cloud-init
qm set "$NEW_VMID" --ipconfig0 "ip=${IP_CONFIG},gw=${GATEWAY}"

# Optional: Resize the disk if needed (e.g., add 20G). Uncomment to use.
# qm resize "$NEW_VMID" scsi0 +20G

echo "⚡️ Starting VM $NEW_VMID..."
qm start "$NEW_VMID"

echo
echo "✅ VM '$NEW_VM_NAME' (ID: $NEW_VMID) has been created and started."
echo "   NOTE: The Cloud-Init snippet file ($SNIPPET_PATH) must persist for Proxmox configuration."
echo

echo "-------------------------------------"
echo " Post-Deployment Instructions "
echo "-------------------------------------"
echo
echo "Your VM is now being provisioned by cloud-init. This may take a few minutes."
echo
echo "  - IP Address: ${IP_CONFIG%/*}" # Extracts the IP from the CIDR format
echo
echo "Next Steps:"
echo "1. Wait a few minutes for the cloud-init setup to complete."
echo "2. SSH into the VM using the user ('loki') and the SSH key you provided:"
echo
echo "   ssh loki@${IP_CONFIG%/*}"
echo
echo "3. Verify that the application is running by checking the Docker containers:"
echo
echo "   docker ps"
echo
echo "Deployment script finished."