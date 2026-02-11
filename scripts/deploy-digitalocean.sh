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
# ./scripts/deploy-digitalocean.sh [droplet-name] [--lite]
#
#   - [droplet-name]: (Optional) The name for the new Droplet.
#                     If not provided, a default name will be used.
#   - --lite:         (Optional) Use the Lite configuration (smaller droplet, lighter stack).
#
# Example:
# ./scripts/deploy-digitalocean.sh my-print-shop
# ./scripts/deploy-digitalocean.sh my-print-shop-lite --lite
#
# ==============================================================================

set -e # Exit immediately if a command exits with a non-zero status.
set -u # Treat unset variables as an error when substituting.
set -o pipefail # Return value of a pipeline is the value of the last command to exit with a non-zero status.

# --- Configuration ---
# You can modify these default values.

# The name for the Droplet. Falls back to a default if no argument is provided.
DROPLET_NAME="print-shop-app"
USE_LITE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --lite)
      USE_LITE=true
      shift # past argument
      ;;
    *)
      if [[ "$1" != -* ]]; then
          DROPLET_NAME="$1"
      fi
      shift # past argument
      ;;
  esac
done

# The region for the Droplet (e.g., nyc3, sfo3).
# Find available regions with `doctl compute region list`.
REGION="nyc3"

# The Droplet image. Ubuntu 22.04 LTS is recommended.
IMAGE="ubuntu-22-04-x64"

# Path to the cloud-config file.
# This script assumes it is run from the project root.
CLOUD_CONFIG_PATH="docs/digitalocean-cloud-config.yml"

# --- Determine Plan and Config ---

if [ "$USE_LITE" = true ]; then
    # Lite Plan: $6/mo (1GB RAM)
    # Uses LowDB and consolidated service stack
    SIZE="s-1vcpu-1gb"
    DOCKER_COMPOSE_FILE="docker-compose.lite.yml"
    echo "🔵 MODE: Lite (LowDB, Single Container, 1GB RAM)"
else
    # Standard Plan: $12/mo (2GB RAM)
    # Uses MongoDB, separate services, better for production
    SIZE="s-1vcpu-2gb"
    DOCKER_COMPOSE_FILE="docker-compose.prod.yml"
    echo "🟢 MODE: Standard (MongoDB, Separate Services, 2GB RAM)"
fi


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

# SSH Key Selection Logic
if [ "$SSH_KEY_FINGERPRINT" == "YOUR_SSH_KEY_FINGERPRINT" ]; then
    echo "SSH_KEY_FINGERPRINT is not configured in the script."
    echo "Fetching available SSH keys from DigitalOcean..."
    echo

    # Check if any keys exist
    KEY_LIST=$(doctl compute ssh-key list --format ID,Name,Fingerprint --no-header)

    if [ -z "$KEY_LIST" ]; then
        echo "Error: No SSH keys found in your DigitalOcean account."
        echo "Please add an SSH key to your DigitalOcean account first."
        echo "See: https://docs.digitalocean.com/products/droplets/how-to/add-ssh-keys/"
        exit 1
    fi

    # Display keys
    doctl compute ssh-key list
    echo

    # Prompt user to select a key
    read -p "Enter the Fingerprint of the SSH key to use: " USER_FINGERPRINT

    if [ -z "$USER_FINGERPRINT" ]; then
        echo "Error: Fingerprint cannot be empty."
        exit 1
    fi

    SSH_KEY_FINGERPRINT="$USER_FINGERPRINT"
    echo "Using SSH Key Fingerprint: $SSH_KEY_FINGERPRINT"
    echo
fi

echo "Configuration:"
echo "  - Droplet Name: $DROPLET_NAME"
echo "  - Region:       $REGION"
echo "  - Size:         $SIZE"
echo "  - Image:        $IMAGE"
echo "  - Stack:        $DOCKER_COMPOSE_FILE"
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

# 3. SMTP Configuration Prompt
echo "-------------------------------------"
echo " Optional SMTP Configuration "
echo "-------------------------------------"
echo "Leave these blank to use the default Google API (legacy)."
echo

read -p "SMTP Host (e.g., smtp.example.com): " SMTP_HOST
if [ -n "$SMTP_HOST" ]; then
    read -p "SMTP Port (default: 587): " SMTP_PORT
    SMTP_PORT=${SMTP_PORT:-587}
    read -p "SMTP User: " SMTP_USER
    read -s -p "SMTP Password: " SMTP_PASS
    echo
    read -p "SMTP From Address (e.g., noreply@example.com): " SMTP_FROM
    read -p "Use Secure Connection? (true/false, default: false): " SMTP_SECURE
    SMTP_SECURE=${SMTP_SECURE:-false}
    read -p "Reject Unauthorized Certs? (true/false, default: true): " SMTP_REJECT_UNAUTHORIZED
    SMTP_REJECT_UNAUTHORIZED=${SMTP_REJECT_UNAUTHORIZED:-true}
fi

# 4. Prepare Cloud Config with Secrets
# We'll use a temporary file to inject secrets, then delete it.
TEMP_CONFIG="cloud-config-generated.yml"
cp "$CLOUD_CONFIG_PATH" "$TEMP_CONFIG"

# Inject the correct Docker Compose filename
sed -i "s|DOCKER_COMPOSE_FILENAME|$DOCKER_COMPOSE_FILE|g" "$TEMP_CONFIG"

# Inject SMTP variables if provided
if [ -n "$SMTP_HOST" ]; then
    # Escape pipe characters in variables to prevent sed from breaking
    ESCAPED_SMTP_USER=$(echo "$SMTP_USER" | sed 's/|/\\|/g')
    ESCAPED_SMTP_PASS=$(echo "$SMTP_PASS" | sed 's/|/\\|/g')
    ESCAPED_SMTP_FROM=$(echo "$SMTP_FROM" | sed 's/|/\\|/g')

    sed -i "s|YOUR_SMTP_HOST|$SMTP_HOST|g" "$TEMP_CONFIG"
    sed -i "s|YOUR_SMTP_PORT|$SMTP_PORT|g" "$TEMP_CONFIG"
    sed -i "s|YOUR_SMTP_USER|$ESCAPED_SMTP_USER|g" "$TEMP_CONFIG"
    sed -i "s|YOUR_SMTP_PASS|$ESCAPED_SMTP_PASS|g" "$TEMP_CONFIG"
    sed -i "s|YOUR_SMTP_SECURE|$SMTP_SECURE|g" "$TEMP_CONFIG"
    sed -i "s|YOUR_SMTP_FROM|$ESCAPED_SMTP_FROM|g" "$TEMP_CONFIG"
    sed -i "s|YOUR_SMTP_REJECT_UNAUTHORIZED|$SMTP_REJECT_UNAUTHORIZED|g" "$TEMP_CONFIG"
else
    # Clear placeholders if not used
    sed -i "s|SMTP_HOST=YOUR_SMTP_HOST|# SMTP_HOST not configured|g" "$TEMP_CONFIG"
    sed -i "s|SMTP_PORT=YOUR_SMTP_PORT|#|g" "$TEMP_CONFIG"
    sed -i "s|SMTP_USER=YOUR_SMTP_USER|#|g" "$TEMP_CONFIG"
    sed -i "s|SMTP_PASS=YOUR_SMTP_PASS|#|g" "$TEMP_CONFIG"
    sed -i "s|SMTP_SECURE=YOUR_SMTP_SECURE|#|g" "$TEMP_CONFIG"
    sed -i "s|SMTP_FROM=YOUR_SMTP_FROM|#|g" "$TEMP_CONFIG"
    sed -i "s|SMTP_REJECT_UNAUTHORIZED=YOUR_SMTP_REJECT_UNAUTHORIZED|#|g" "$TEMP_CONFIG"
fi

# 5. Create the Droplet
echo
echo "🚀 Creating Droplet '$DROPLET_NAME'..."

doctl compute droplet create "$DROPLET_NAME" \
    --region "$REGION" \
    --size "$SIZE" \
    --image "$IMAGE" \
    --ssh-keys "$SSH_KEY_FINGERPRINT" \
    --user-data-file "$TEMP_CONFIG" \
    --wait

# Cleanup sensitive config
rm "$TEMP_CONFIG"

echo
echo "✅ Droplet '$DROPLET_NAME' has been created successfully."
echo

# 6. Get Droplet IP and provide next steps
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
if [ "$USE_LITE" = true ]; then
  echo "   cd /home/loki/lokimetasmith.github.io && docker-compose -f docker-compose.lite.yml restart"
else
  echo "   cd /home/loki/lokimetasmith.github.io && docker-compose -f docker-compose.prod.yml restart"
fi
echo
echo "Deployment script finished."
