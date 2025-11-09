# Secure Self-Hosting with a Reverse SSH Tunnel

This document explains how to host the Print Shop application on a home server while making it securely accessible from the internet via a DigitalOcean droplet. This setup enhances security by not exposing your home IP address or requiring you to open ports on your home router.

## How It Works

The core of this setup is a **reverse SSH tunnel**. Here's the process:

1.  A lightweight **DigitalOcean droplet** acts as a secure, public-facing entry point. It runs an Nginx server to handle incoming web traffic.
2.  Your **home server**, where the actual application is running, initiates a secure SSH connection *out* to the droplet.
3.  This SSH connection is configured to "reverse" the flow of traffic. The droplet forwards all incoming web requests through this secure tunnel to the application on your home server.
4.  The application processes the request and sends the response back through the tunnel to the droplet, which then delivers it to the user.

![Reverse SSH Tunnel Diagram](https://i.imgur.com/example-diagram.png) *(Note: This is a placeholder for a real diagram)*

**Key Advantages:**
*   **Security:** Your home server's IP address is never exposed. No inbound ports need to be opened on your home firewall.
*   **Simplicity:** It avoids the complexity of setting up a full VPN.
*   **Control:** You maintain full control over the application and its data on your own hardware.

---

## Setup Instructions

Follow these steps in order to deploy and configure the system.

### Step 1: Prepare Your Home Server

First, you need to generate a dedicated SSH key pair that will be used to secure the tunnel.

1.  **Log into your home server.**
2.  Navigate to the `scripts` directory in the project.
3.  Run the home server setup script:
    ```bash
    bash ./setup-home-server.sh
    ```
4.  This script will guide you through generating an SSH key. It will then display your new **public key**. Copy this key to your clipboard.

### Step 2: Configure and Deploy the Tunnel Droplet

Now, you will configure and create the public-facing server on DigitalOcean.

1.  **On your local development machine**, open the file `docs/tunnel-droplet-cloud-config.yml`.
2.  Find the line that says `ssh-rsa AAAA... your_home_server_ssh_public_key`.
3.  **Replace that entire line** with the public key you copied from your home server.
4.  Next, open the deployment script `scripts/deploy-tunnel-droplet.sh`.
5.  Find the `SSH_KEY_FINGERPRINT` variable and replace `"YOUR_SSH_KEY_FINGERPRINT"` with the fingerprint of the SSH key you use to access DigitalOcean droplets.
6.  Run the deployment script:
    ```bash
    bash ./scripts/deploy-tunnel-droplet.sh
    ```
7.  The script will create the droplet and display its **public IP address**. Note this down.

### Step 3: Start the Tunnel

Finally, establish the connection between your home server and the new droplet.

1.  **Go back to your home server's terminal.**
2.  The `setup-home-server.sh` script provided you with a final `autossh` command. Run this command, but be sure to replace `YOUR_DROPLET_IP` with the actual IP address of the droplet you just created.
    ```bash
    # Example command:
    autossh -M 0 -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" \
      -i ~/.ssh/id_rsa_tunnel \
      -R 8080:localhost:3000 \
      tunneluser@YOUR_DROPLET_IP
    ```
3.  To keep the tunnel running in the background, you can append `&` to the command or, for a more robust solution, set it up as a systemd service.

### Step 4: Finalization

1.  **Update your DNS:** Point your domain name (e.g., `shop.yourdomain.com`) to the public IP address of your DigitalOcean droplet.
2.  **Run the Application:** Make sure the Print Shop application is running on your home server (`node server/index.js` or via Docker).

Your application should now be accessible via your domain name, securely served from your home server.

---

## Managing the Setup

*   **To stop the tunnel**, find the `autossh` process on your home server and terminate it (`pkill autossh`).
*   **To destroy the droplet**, you can do so from the DigitalOcean control panel or by using `doctl compute droplet delete <droplet-name>`.
