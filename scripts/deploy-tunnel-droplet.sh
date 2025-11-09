#!/bin/bash

# ==============================================================================
# DigitalOcean Tunnel Droplet Deployment Script
# ==============================================================================
#
# Description:
# This script automates the creation of a DigitalOcean Droplet that acts as a
# secure endpoint for a reverse SSH tunnel from a home server. It sets up a
# dedicated user for the tunnel and configures Nginx to proxy traffic to the
# application running on the home server.
#
# Prerequisites:
# 1. doctl (DigitalOcean Command-Line Tool) must be installed and authenticated.
# 2. An SSH key added to your DigitalOcean account. You will need its fingerprint.
# 3. A separate SSH key pair for the tunnel connection. The public key will be
#    needed for the cloud-config.
#
# Usage:
# ./scripts/deploy-tunnel-droplet.sh [droplet-name]
#
# ==============================================================================

set -e
set -u
set -o pipefail

# --- Configuration ---
DROPLET_NAME="${1:-print-shop-tunnel}"
REGION="nyc3"
SIZE="s-1vcpu-1gb"
IMAGE="ubuntu-22-04-x64"
CLOUD_CONFIG_PATH="docs/tunnel-droplet-cloud-config.yml"
SSH_KEY_FINGERPRINT="YOUR_SSH_KEY_FINGERPRINT"

# --- Script Logic ---
echo "-------------------------------------"
echo " Tunnel Droplet Deployment to DigitalOcean "
echo "-------------------------------------"
echo

if ! command -v doctl &> /dev/null; then
    echo "Error: 'doctl' is not installed."
    exit 1
fi

if [ ! -f "$CLOUD_CONFIG_PATH" ]; then
    echo "Error: Cloud-config file not found at '$CLOUD_CONFIG_PATH'."
    exit 1
fi

if [ "$SSH_KEY_FINGERPRINT" == "YOUR_SSH_KEY_FINGERPRINT" ]; then
    echo "Error: Please update the SSH_KEY_FINGERPRINT variable in this script."
    exit 1
fi

echo "Configuration:"
echo "  - Droplet Name: $DROPLET_NAME"
echo "  - Region:       $REGION"
echo "  - Size:         $SIZE"
echo "  - Image:        $IMAGE"
echo "  - SSH Key:      $SSH_KEY_FINGERPRINT"
echo "  - User Data:    $CLOUD_CONFIG_PATH"
echo

read -p "Do you want to create this Droplet? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 1
fi

echo "🚀 Creating Droplet '$DROPLET_NAME'..."

doctl compute droplet create "$DROPLET_NAME" \
    --region "$REGION" \
    --size "$SIZE" \
    --image "$IMAGE" \
    --ssh-keys "$SSH_KEY_FINGERPRINT" \
    --user-data-file "$CLOUD_CONFIG_PATH" \
    --wait

echo "✅ Droplet '$DROPLET_NAME' has been created successfully."

DROPLET_IP=$(doctl compute droplet get "$DROPLET_NAME" --format "PublicIPv4" --no-header)

echo "-------------------------------------"
echo " Post-Deployment Instructions "
echo "-------------------------------------"
echo
echo "Your Tunnel Droplet is now provisioned."
echo "  - Public IP Address: $DROPLET_IP"
echo
echo "Next Steps:"
echo "1. Update your DNS records to point your domain to $DROPLET_IP."
echo "2. Use the 'scripts/setup-home-server.sh' script to configure your home server and establish the tunnel."
echo
echo "ssh root@$DROPLET_IP"
echo
echo "Deployment script finished."