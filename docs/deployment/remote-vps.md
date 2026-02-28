# Remote Cloud VPS Deployment

This guide covers deploying the Print Shop application to a production environment on a remote Virtual Private Server (VPS) from a cloud provider like DigitalOcean, Vultr, Linode, or AWS.

We present three methods:

1.  **Automated Deployment Script (DigitalOcean):** The easiest way to deploy to DigitalOcean using a provided shell script.
2.  **Manual Cloud-Init Deployment:** For advanced users who want to manually configure the cloud-init user data, supporting both Podman and Docker.
3.  **Manual Deployment (Legacy):** This is a traditional, non-containerized guide for setting up the application step-by-step.

---

## Method 1: Automated Deployment Script (DigitalOcean)

This method uses a shell script to automate the creation and provisioning of a new DigitalOcean Droplet. The Droplet will be fully configured to build and run the application using Docker and Nginx.

### Prerequisites

Before you begin, ensure you have the following:

1.  **DigitalOcean Account**: You'll need an active account.
2.  **`doctl` CLI Tool**: The official DigitalOcean command-line tool must be installed and authenticated.
    *   **Installation**: Follow the official instructions at [docs.digitalocean.com/reference/doctl/how-to/install/](https://docs.digitalocean.com/reference/doctl/how-to/install/).
    *   **Authentication**: Run `doctl auth init` and provide your personal access token. The token needs read and write permissions.
3.  **SSH Key in DigitalOcean**: You must have an SSH public key uploaded to your DigitalOcean account. You will need its fingerprint.
    *   You can find the fingerprint in your DigitalOcean control panel under **Settings -> Security**.
    *   Alternatively, use the command: `doctl compute ssh-key list`.

### Step 1: Configure the Deployment Script

The deployment process is managed by the `deploy-digitalocean.sh` script. You can either hardcode your SSH key fingerprint or let the script guide you interactively.

**Option A: Hardcode SSH Key (Recommended for automation)**
1.  Open the script file: `scripts/deploy-digitalocean.sh`.
2.  Find the `SSH_KEY_FINGERPRINT` variable.
3.  Replace the placeholder value `"YOUR_SSH_KEY_FINGERPRINT"` with the actual fingerprint of the SSH key you want to use for the new Droplet.

**Option B: Interactive Mode**
If you leave the `SSH_KEY_FINGERPRINT` variable as is, the script will automatically detect that it's unset and will fetch a list of your available SSH keys from DigitalOcean, allowing you to select one interactively.

### Step 2: Run the Deployment Script

Once the script is configured, you can run it from the root of the project. You have two options for deployment:

**Option A: Standard Deployment (Default)**
*   **Best for:** Production environments.
*   **Specs:** 2GB RAM ($12/mo), MongoDB, separate service containers.
*   **Command:**
    ```bash
    ./scripts/deploy-digitalocean.sh [optional-droplet-name]
    ```

**Option B: Lite Deployment**
*   **Best for:** Testing or low-traffic personal use.
*   **Specs:** 1GB RAM ($6/mo), LowDB (file-based), single container.
*   **Command:**
    ```bash
    ./scripts/deploy-digitalocean.sh [optional-droplet-name] --lite
    ```

**Execution:**

1.  Make sure the script is executable:
    ```bash
    chmod +x scripts/deploy-digitalocean.sh
    ```

2.  Run the command for your chosen mode.
    ```bash
    # Example: Standard deployment
    ./scripts/deploy-digitalocean.sh my-print-shop

    # Example: Lite deployment
    ./scripts/deploy-digitalocean.sh my-print-shop-lite --lite
    ```

The script will now:
*   Confirm the settings with you.
*   Create the Droplet on your DigitalOcean account.
*   Use the `docs/digitalocean-cloud-config.yml` file to provision the server. This includes installing Docker, cloning the repository, and starting the application.
*   Output the new Droplet's IP address.

### Step 3: Post-Deployment Configuration

The server is now running, but you must perform a few manual steps to finalize the setup.

1.  **SSH into the new Droplet**:
    The script creates a user named `loki`. Use the IP address from the script's output to connect:
    ```bash
    ssh loki@YOUR_DROPLET_IP
    ```

2.  **Update Configuration Files**:
    The server was provisioned using a template. You **must** replace the placeholder values in the Nginx and environment configuration files.

    *   **Edit the environment file**:
        ```bash
        nano /home/loki/lokimetasmith.github.io/.env
        ```
        Replace all placeholders like `YOUR_DROPLET_IP`, `YOUR_PRODUCTION_SQUARE_TOKEN`, etc., with your actual production credentials and secrets.

    *   **Edit the Nginx config**:
        ```bash
        nano /home/loki/lokimetasmith.github.io/nginx.conf
        ```
        Update the `server_name` directive to your domain or the Droplet's IP address.

3.  **Restart the Services**:
    After saving your changes to the configuration files, restart the Docker containers to apply them.

    **Note:** Ensure you use the correct docker-compose file for your deployment mode.

    ```bash
    cd /home/loki/lokimetasmith.github.io

    # For Standard Deployment:
    docker-compose -f docker-compose.prod.yml restart

    # For Lite Deployment:
    docker-compose -f docker-compose.lite.yml restart
    ```

4.  **Update DNS (Optional but Recommended)**:
    If you have a domain name, create an 'A' record in your DNS provider's dashboard and point it to the Droplet's IP address.

Your application is now deployed and live!

---

## Method 2: Manual Cloud-Init Deployment

This method gives you more control and works with any cloud provider that supports cloud-init. We provide two cloud-init scripts: one using Podman (recommended) and one using Docker (legacy).

### Method 2a: Podman and Systemd (Recommended)

This approach is the most secure and robust. It uses Podman to run the containers without a privileged daemon and manages the application with a proper systemd service for maximum stability.

1.  **Use the `docs/cloud-config-podman.example.yml` file.** This file is designed for this modern workflow.
2.  **Customize the Configuration:**
    - Make a copy of the file named `my-cloud-config.yml`.
    - Add your public SSH key.
    - Fill in all the placeholder secrets in the `secrets.yml` section.
    - If you have a private container registry, update the image name in the `pod.yml` section.
3.  **Launch Your Server:**
    - Follow the "Launch the Server" steps below, using the content of your customized `my-cloud-config.yml` file as the User Data.
    - The script will automatically build the application, create the pod, and enable a systemd service to manage it.

### Method 2b: Docker (Legacy)

This approach uses the original Docker-based cloud-init script.

1.  **Use the `docs/cloud-config.example.yml` file.**
2.  **Customize the Configuration:**
    - Make a copy of the file named `my-cloud-config.yml`.
    - Add your public SSH key.
    - Fill in all the placeholder secrets in the `.env` section.
3.  **Launch Your Server:**
    - Follow the "Launch the Server" steps below, using the content of your customized `my-cloud-config.yml` file as the User Data.

---

### Launch the Server (DigitalOcean Example)

1.  Log in to your [DigitalOcean](https://www.digitalocean.com/) account.
2.  Click **Create -> Droplet**.
3.  **Choose an image:** Select **Ubuntu 22.04 (LTS) x64**.
4.  **Choose a plan:** A basic shared CPU droplet is a good starting point.
5.  **Authentication:** Ensure your SSH key (the same one you added to your config file) is selected.
6.  **Select additional options:** Check the box for **User Data**.
7.  **Provide User Data:** A text box will appear. Copy the _entire contents_ of your customized `my-cloud-config.yml` file and paste it into this box.
8.  Finalize the droplet details (hostname, etc.) and click **Create Droplet**.

DigitalOcean will now create the server. On its first boot, it will automatically execute your script. This may take 3-5 minutes.

### Post-Deployment Steps

1.  **Point your Domain:** Once the droplet is created, find its public IP address. Go to your domain registrar and create an **A record** that points your desired domain (e.g., `print-shop.yourdomain.com`) to this IP address.

2.  **Setting up HTTPS (Manual Step):**
    The cloud-init script sets up an Nginx server on port 80 (HTTP). To enable HTTPS, you need to configure it manually.
    - SSH into your new server: `ssh loki@YOUR_DROPLET_IP`
    - You can use a tool like Certbot to obtain and install a free SSL certificate from Let's Encrypt for your Nginx container. Detailed guides for this are widely available online.

After these steps, your application will be live and running in a containerized environment.

---
---

## Best Practices for Secure Deployment & Team Access

When deploying to a remote VPS like DigitalOcean in a production environment, especially for a team, it is highly recommended to adopt advanced deployment strategies and strict security measures.

### Deployment Strategies & Secure Key Management

*   **Infrastructure as Code (Terraform)**: For production and team environments, manage your Droplets using Infrastructure as Code (IaC) tools like Terraform. Define your infrastructure as code to manage Droplets, allowing you to define SSH keys via `digitalocean_ssh_key` resource and reference them in `digitalocean_droplet` without hardcoding keys in scripts.
*   **DigitalOcean Team SSH Keys**: Add public keys to your DigitalOcean account/team rather than individual droplets. This allows new droplets to automatically include necessary keys at creation, keeping access centralized and secure.
*   **CI/CD Pipeline Integration (GitLab CI/GitHub Actions)**: Use GitHub Actions or similar tools to build and deploy. Store the private SSH key securely in the CI/CD's secret management system (e.g., GitHub Secrets), allowing the pipeline to deploy without any developer needing to hold the key.
*   **Secure Access via SSH Keys**: Prefer SSH key-based authentication exclusively, disabling root passwords in `/etc/ssh/sshd_config` for better security.

### Developer-Agnostic Workflow

*   **Use GitOps**: All infrastructure changes are handled via pull requests, making deployment steps transparent and consistent, removing dependency on specific machines.
*   **API-Driven Provisioning**: Use the DigitalOcean API to trigger deployment actions, ensuring the process is automated and not reliant on a specific user's terminal.

### Additional Best Practices

*   **Firewall Configuration**: Create a Cloud Firewall to restrict access to authorized IP addresses (e.g., CI/CD IPs) and block unused ports.
*   **Immutable Infrastructure**: Rebuild droplets from images rather than updating in-place to ensure consistency and reproducible environments.
*   **2FA & Team Access**: Enable Two-Factor Authentication (2FA) for all team members in your DigitalOcean account to prevent unauthorized access.

---

## Method 3: Manual Deployment (Legacy)

This method walks you through setting up the application manually on a fresh server without using Docker.

### 1. Production Server Setup

Before deploying, ensure your server (e.g., a Linux VM) has the necessary software.

**Prerequisites:**

- **Node.js** (v18 or later)
- **npm** (comes with Node.js)
- **Nginx** (or another web server) to act as a reverse proxy.
- **PM2** (a process manager for Node.js) installed globally: `npm install -g pm2`
- **Git**

### 2. Code Deployment & Preparation

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/LokiMetaSmith/lokimetasmith.github.io.git
    cd lokimetasmith.github.io
    ```
2.  **Install Dependencies:**
    ```bash
    # Install root and server dependencies
    npm install
    cd server
    npm install --production
    cd ..
    ```
3.  **Build the Frontend:**
    ```bash
    npm run build
    ```

### 3. Configuration

#### Nginx Configuration

1.  Create a new Nginx config file (e.g., `/etc/nginx/sites-available/printshop`).
2.  Add a server block. **You must customize this for your setup.**

    ```nginx
    server {
        listen 80;
        server_name your_domain.com;

        root /path/to/your/project/dist;
        index index.html;

        location / {
            try_files $uri $uri/ =404;
        }

        location ~ ^/(api|uploads|auth|oauth2callback) {
            proxy_pass http://localhost:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }
    }
    ```

3.  Enable the site: `sudo ln -s /etc/nginx/sites-available/printshop /etc/nginx/sites-enabled/` and restart Nginx.
4.  **Crucially, set up HTTPS using Let's Encrypt / Certbot.**

#### Environment Variables

In production, do not use a `.env` file. Set environment variables using your server's operating system (e.g., via `/etc/environment` or a systemd service file for PM2). See `server/ENV_DOCUMENTATION.md` for a list of all required variables.

#### Data Persistence

You **must** ensure these locations are backed up and persist across deployments:

- **Database:** The file specified by `DB_PATH`. Store it outside the project folder (e.g., `/var/data/db.json`).
- **File Uploads:** The `server/uploads/` directory.

### 4. Launching the Application

Use `pm2` to run the backend as a persistent background service.

> **A More Modern Alternative: Podman and Systemd**
> While `pm2` is a valid way to manage Node.js processes, a more modern, robust, and secure method is to run the application in a container using Podman and manage it with a native systemd service.
>
> This involves running the application container with `podman` and then using the `podman generate systemd` command to create a service file. This approach provides better isolation and integrates perfectly with the Linux service management ecosystem. The upcoming Podman-based cloud-init script will use this superior method.

1.  **Navigate to the server directory:** `cd /path/to/your/project/server`
2.  **Start the server:** `pm2 start index.js --name "print-shop-backend"`
3.  **Save the process list:** `pm2 save`

Your application is now deployed. Monitor it with `pm2 status` or `pm2 logs print-shop-backend`.
