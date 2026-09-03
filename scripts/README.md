# Splotch Deployment & Maintenance Scripts

This directory contains automation scripts to streamline deploying, hosting, and maintaining the Splotch Print Shop application. 

The scripts are divided into a few main categories: **Direct Cloud Deployment**, **Home Server / Proxmox Hosting**, **Reverse Tunneling**, and **Maintenance & Testing**.

---

## 1. Direct Cloud Deployment

If you are hosting the app directly on a Virtual Private Server (VPS), use these scripts to automate the infrastructure provisioning.

### `deploy-digitalocean.sh`
Automates the creation of a full standalone DigitalOcean droplet running the Splotch stack via Docker.
* **What it does:** Uses the `doctl` CLI to spin up an Ubuntu Droplet, injects secrets directly from your local `.env` file into a `cloud-config.yml` template, and installs Docker/Node to run the app.
* **Usage:** `./deploy-digitalocean.sh [droplet-name] [--lite]`
* **Requirements:** `doctl` authenticated with a valid DigitalOcean API token.

---

## 2. On-Premises & Proxmox Hosting

If you are self-hosting on your own hardware, use these tools to provision your local environments.

### `deploy-proxmox.sh`
Automates the creation of a new Virtual Machine on a Proxmox VE host.
* **What it does:** Clones a cloud-init-ready Ubuntu template, configures it with user data, sets network properties, and starts the VM to run the Splotch stack.
* **Usage:** Run this directly on the Proxmox VE host as the `root` user: `./deploy-proxmox.sh`
* **Requirements:** A cloud-init-ready VM template must already exist on your Proxmox host.

### `deploy-nat-gateway.sh`
Configures a NAT Gateway for environments where backend components need outbound internet access without being publicly exposed.

---

## 3. Secure Self-Hosting (Without Exposing Ports)

This is the recommended approach for hosting from home without exposing your home IP address or opening router ports on your home firewall.

### Option A: Cloudflare Tunnel (Recommended & Free)
The `deploy-cloudflare-tunnel.sh` script automates setting up a free Cloudflare Tunnel (`cloudflared`). 
* **What it does:** Installs the `cloudflared` daemon, prompts you to log into Cloudflare, creates a secure outbound tunnel, routes it to a custom domain, and installs it as a background service. It completely hides your home IP and provides instant SSL (HTTPS) and DDoS protection.
* **Usage:** Run `sudo bash ./deploy-cloudflare-tunnel.sh` on the home server hosting Splotch.

**Important Notes on Cloudflare Setup (It is 100% free):**
Cloudflare does not charge anything to manage your domain’s DNS, and you do not have to transfer registration or pay Cloudflare to switch DNS management.

**How It Works:**
* **Registration remains with your current registrar:** You keep paying your current registrar (e.g., Namecheap, Google Domains/Squarespace, GoDaddy, Porkbun) their normal annual renewal fee for the domain name itself.
* **Authoritative DNS points to Cloudflare:** At your registrar’s dashboard, you simply replace their default nameservers with the two assigned Cloudflare nameservers (e.g., `alec.ns.cloudflare.com` and `nina.ns.cloudflare.com`).

**Cloudflare's Free Tier covers:**
* Authoritative DNS hosting and fast propagation.
* Free SSL/TLS edge certificates (automatic HTTPS).
* Unlimited bandwidth through Cloudflare Tunnels (`cloudflared`).
* Basic DDoS protection and CDN caching.
* Zero Trust / Access policies (free for up to 50 users, useful if you want to put authentication in front of private tunnel endpoints).

**What to Expect During Setup:**
1. Add your existing domain in the Cloudflare dashboard (select the Free plan).
2. Cloudflare will scan and copy over your existing DNS records (MX records for email, TXT records for verification, etc.).
3. Log into your current registrar, find the Nameservers / Custom DNS setting, and paste in the two Cloudflare nameservers.
4. Once nameservers propagate (usually a few minutes to an hour), Cloudflare takes over DNS routing, and your `deploy-cloudflare-tunnel.sh` script will be able to automatically create tunnel DNS records against your domain.

### Option B: Reverse SSH Tunnel (DigitalOcean)

### Overview
1. A lightweight **DigitalOcean tunnel droplet** acts as a secure, public-facing entry point running an Nginx reverse proxy.
2. Your **home server** (running the actual app) initiates a secure SSH connection *out* to the droplet.
3. This SSH connection reverses the flow of traffic, securely routing public web requests down into your home server.

### Scripts used in this setup:
* **`setup-home-server.sh`**: Run this on your home server first. It generates a dedicated SSH key pair used to secure the tunnel and outputs your public key.
* **`deploy-tunnel-droplet.sh`**: Run this on your local machine. It uses `doctl` to provision the lightweight public-facing droplet. Make sure you update the `docs/tunnel-droplet-cloud-config.yml` with your home server's public key before running.

### Tunnel Setup Instructions:
1. **Prepare Home Server:** Run `bash ./setup-home-server.sh` on your local/Proxmox server. Copy the public key it outputs.
2. **Prepare Droplet:** On your development machine, open `docs/tunnel-droplet-cloud-config.yml` and replace the placeholder SSH key with the one you just copied.
3. **Deploy Droplet:** Edit `deploy-tunnel-droplet.sh` to include your DigitalOcean SSH Key Fingerprint, then run `bash ./deploy-tunnel-droplet.sh`. Note the IP address it outputs.
4. **Start the Tunnel:** Go back to your home server and run the `autossh` command provided by step 1, using your new droplet IP:
   ```bash
   autossh -M 0 -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" \
     -i ~/.ssh/id_rsa_tunnel \
     -R 8080:localhost:3000 \
     tunneluser@YOUR_DROPLET_IP
   ```
5. **Update DNS:** Point your domain to the new DigitalOcean Tunnel Droplet IP.

---

## 4. Maintenance & Testing

### `backup.sh`
Automates backups of the application database (`db.json`) and uploaded assets. Run this manually or set it up as a cron job to ensure data safety.

### `check-uptime.js`
A Node script that pings the application endpoints to verify it is responsive and running correctly.

### `update-dns-record.sh`
Automates updating DigitalOcean DNS records (useful if your home ISP changes your public IP dynamically, or to script pointing domains to new deployments).

### `generate-nginx-config.sh`
Dynamically generates an Nginx server block configuration for reverse-proxying the frontend/backend on standard Linux hosts.

### `run-live-test.mjs`
A Playwright script used to run an end-to-end (e2e) test against a live deployment to verify functionality (e.g. testing the UI and Square integrations).

---

## 5. Hardware Integration & SBCs

These scripts are used to provision local Single Board Computers (SBCs) to act as physical drop boxes or networking hubs for the printing hardware.

### `setup-sbc-init.sh`
The master initialization script for provisioning a fresh Ubuntu SBC (like the GMKtec N150). It handles system updates, firmware upgrades, core utility installations, configures the UFW firewall, and triggers the USB automounter script.

### `setup-usb-automount.sh`
Configures `udev` and `autofs` on an Ubuntu SBC to automatically mount inserted USB flash drives with the `sync` option, ensuring that processed sticker images are safely flushed to physical storage instantly. 
* **Usage:** `sudo bash ./setup-usb-automount.sh`

### `activate-usb-mounts.sh`
A helper script that scans for inserted USB drives mapped by the udev rules and actively triggers their `autofs` mounting sequence so they become instantly accessible to the backend application at `/media/auto_mount_usb`.
