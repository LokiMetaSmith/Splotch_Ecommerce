#!/bin/bash

# ==============================================================================
# Home Server Setup Script for Reverse SSH Tunnel
# ==============================================================================
#
# Description:
# This file provides instructions and commands to set up your home server to
# connect to the DigitalOcean tunnel droplet. This setup will forward traffic
# from the public droplet to your local application.
#
# Instructions:
# Follow the steps below. Copy and paste the commands into your home server's
# terminal.
#
# ==============================================================================

echo "-------------------------------------"
echo " Home Server Setup Instructions "
echo "-------------------------------------"
echo

# --- Step 1: Generate a dedicated SSH key for the tunnel ---
echo "[Step 1] Generating a new SSH key pair..."
echo "When prompted, press Enter to accept the default file location and to"
echo "create the key without a passphrase for automated connections."
echo

ssh-keygen -t rsa -b 4096 -C "tunnel-key" -f ~/.ssh/id_rsa_tunnel

echo
echo "✅ SSH key pair generated."
echo "   - Private key: ~/.ssh/id_rsa_tunnel"
echo "   - Public key:  ~/.ssh/id_rsa_tunnel.pub"
echo

# --- Step 2: Add the public key to the cloud-config ---
echo "[Step 2] IMPORTANT: Update the cloud-config file."
echo "You must now copy your new public key into the tunnel droplet's"
echo "configuration file before you deploy the droplet."
echo
echo "1. Display your public key by running this command:"
echo "   cat ~/.ssh/id_rsa_tunnel.pub"
echo
echo "2. Open the file 'docs/tunnel-droplet-cloud-config.yml'."
echo "3. Find the line 'ssh-rsa AAAA... your_home_server_ssh_public_key'."
echo "4. Replace that entire line with the contents of your public key."
echo

# --- Step 3: Deploy the tunnel droplet ---
echo "[Step 3] Deploy your tunnel droplet."
echo "After updating the cloud-config, run the deployment script from your"
echo "local machine (not the home server):"
echo "   ./scripts/deploy-tunnel-droplet.sh"
echo
echo "Once it's created, note down the droplet's public IP address."
echo

# --- Step 4: Establish the persistent SSH tunnel ---
echo "[Step 4] Start the reverse SSH tunnel."
echo "To ensure the tunnel is persistent, it is recommended to use 'autossh'."
echo "You may need to install it first:"
echo "   sudo apt-get update && sudo apt-get install autossh"
echo
echo "Run the following command on your home server. Replace 'YOUR_DROPLET_IP'"
echo "with the actual IP address of your new tunnel droplet."
echo
echo "The command forwards traffic from port 8080 on the droplet to port 3000"
echo "on your home server (where your application is running)."
echo

echo "# --- Command to start the tunnel ---"
echo "autossh -M 0 -o \"ServerAliveInterval 30\" -o \"ServerAliveCountMax 3\" \\"
echo "  -i ~/.ssh/id_rsa_tunnel \\"
echo "  -R 8080:localhost:3000 \\"
echo "  tunneluser@YOUR_DROPLET_IP"
echo "# -----------------------------------"
echo

echo "To run this in the background, you can append '&' to the command."
echo
echo "For a truly robust setup, consider creating a systemd service to manage"
echo "the autossh connection automatically. See the 'scripts/README.md' for an example."
echo
echo "Setup instructions complete."