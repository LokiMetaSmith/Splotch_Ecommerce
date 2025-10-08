#!/bin/bash

# ==============================================================================
# DigitalOcean Droplet Deployment Script
# ==============================================================================
#
# Description:
# This script automates the creation of a new DigitalOcean Droplet and
# provisions it to run the Print Shop application using a cloud-config file.
#
# Prerequisites:
# 1. doctl (DigitalOcean Command-Line Tool) must be installed and authenticated.
#    - Installation: https://docs.digitalocean.com/reference/doctl/how-to/install/
#    - Authentication: Run `doctl auth init` and follow the prompts.
# 2. A DigitalOcean personal access token with read/write permissions.
# 3. An SSH key added to your DigitalOcean account. You will need its fingerprint.
#
# Usage:
# ./scripts/deploy-digitalocean.sh [droplet-name]
#
#   - [droplet-name]: (Optional) The name for the new Droplet.
#                     If not provided, a default name will be used.
#
# Example:
# ./scripts/deploy-digitalocean.sh my-print-shop
#
# ==============================================================================

set -e # Exit immediately if a command exits with a non-zero status.
set -u # Treat unset variables as an error when substituting.
set -o pipefail # Return value of a pipeline is the value of the last command to exit with a non-zero status.

# --- Configuration ---
# You can modify these default values.

# The name for the Droplet. Falls back to a default if no argument is provided.
DROPLET_NAME="${1:-print-shop-app}"

# The region for the Droplet (e.g., nyc3, sfo3).
# Find available regions with `doctl compute region list`.
REGION="nyc3"

# The size of the Droplet (e.g., s-1vcpu-1gb).
# Find available sizes with `doctl compute size list`.
SIZE="s-1vcpu-1gb"

# The Droplet image. Ubuntu 22.04 LTS is recommended.
IMAGE="ubuntu-22-04-x64"

# Path to the cloud-config file.
# This script assumes it is run from the project root.
CLOUD_CONFIG_PATH="docs/digitalocean-cloud-config.yml"

# --- SSH Key Configuration ---
# IMPORTANT: Replace with your SSH key fingerprint.
# Find your key's fingerprint in the DigitalOcean control panel under
# "Settings" -> "Security", or by using `doctl compute ssh-key list`.
SSH_KEY_FINGERPRINT="YOUR_SSH_KEY_FINGERPRINT"


# --- Script Logic ---

echo "-------------------------------------"
echo " Print Shop Deployment to DigitalOcean "
echo "-------------------------------------"
echo

# 1. Validate prerequisites
if ! command -v doctl &> /dev/null; then
    echo "Error: 'doctl' is not installed. Please install it to continue."
    echo "See: https://docs.digitalocean.com/reference/doctl/how-to/install/"
    exit 1
fi

if [ ! -f "$CLOUD_CONFIG_PATH" ]; then
    echo "Error: Cloud-config file not found at '$CLOUD_CONFIG_PATH'."
    echo "Please ensure the file exists and the script is run from the project root."
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

# 2. Confirm with the user before proceeding
read -p "Do you want to create this Droplet? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 1
fi

# 3. Create the Droplet
echo
echo "🚀 Creating Droplet '$DROPLET_NAME'..."

doctl compute droplet create "$DROPLET_NAME" \
    --region "$REGION" \
    --size "$SIZE" \
    --image "$IMAGE" \
    --ssh-keys "$SSH_KEY_FINGERPRINT" \
    --user-data-file "$CLOUD_CONFIG_PATH" \
    --wait

echo
echo "✅ Droplet '$DROPLET_NAME' has been created successfully."
echo

# 4. Get Droplet IP and provide next steps
DROPLET_IP=$(doctl compute droplet get "$DROPLET_NAME" --format "PublicIPv4" --no-header)

echo "-------------------------------------"
echo " Post-Deployment Instructions "
echo "-------------------------------------"
echo
echo "Your Droplet is now being provisioned. This may take a few minutes."
echo
echo "  - Public IP Address: $DROPLET_IP"
echo
echo "Next Steps:"
echo "1. IMPORTANT: Update your DNS records to point your domain to $DROPLET_IP."
echo "2. IMPORTANT: Replace all placeholder values (like 'YOUR_DROPLET_IP', 'YOUR_DOMAIN_OR_IP')"
echo "   in your production '.env' and 'nginx.conf' files on the server."
echo "   You can SSH into the Droplet to do this:"
echo
echo "   ssh loki@$DROPLET_IP"
echo
echo "3. After SSHing in, you may need to restart the services for the changes to take effect:"
echo
echo "   cd /home/loki/lokimetasmith.github.io && docker-compose restart"
echo
echo "Deployment script finished."