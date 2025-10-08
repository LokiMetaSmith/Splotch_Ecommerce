# Deployment Guide

This guide provides instructions for deploying the Print Shop application. We'll cover two primary methods:

1.  **Automated Production Deployment to DigitalOcean**: The recommended method for a live, production environment.
2.  **Local Development with Docker**: For setting up a local, containerized environment that mirrors production.

---

## 1. Automated Production Deployment to DigitalOcean

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

The deployment process is managed by the `deploy-digitalocean.sh` script. You need to edit one variable within this file before running it.

1.  Open the script file: `scripts/deploy-digitalocean.sh`.
2.  Find the `SSH_KEY_FINGERPRINT` variable.
3.  Replace the placeholder value `"YOUR_SSH_KEY_FINGERPRINT"` with the actual fingerprint of the SSH key you want to use for the new Droplet.

    ```bash
    # scripts/deploy-digitalocean.sh

    # ...
    # IMPORTANT: Replace with your SSH key fingerprint.
    SSH_KEY_FINGERPRINT="PASTE_YOUR_ACTUAL_SSH_KEY_FINGERPRINT_HERE"
    # ...
    ```

### Step 2: Run the Deployment Script

Once the script is configured, you can run it from the root of the project.

1.  Make sure the script is executable:
    ```bash
    chmod +x scripts/deploy-digitalocean.sh
    ```

2.  Run the script. You can optionally provide a name for your Droplet as an argument.
    ```bash
    # With a custom name
    ./scripts/deploy-digitalocean.sh my-print-shop

    # Or with the default name ('print-shop-app')
    ./scripts/deploy-digitalocean.sh
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
    After saving your changes to the configuration files, restart the Docker containers to apply them:
    ```bash
    cd /home/loki/lokimetasmith.github.io
    docker-compose restart
    ```

4.  **Update DNS (Optional but Recommended)**:
    If you have a domain name, create an 'A' record in your DNS provider's dashboard and point it to the Droplet's IP address.

Your application is now deployed and live!

---

## 2. Local Development with Docker

You can run a containerized version of this application on your local machine using the provided `docker-compose.yaml` file. This is useful for testing in an environment that closely resembles production.

### Prerequisites

*   **Docker**: Must be installed and running on your local machine.
*   **Node.js & npm**: Required for the initial frontend build step.

### Steps

1.  **Build Frontend Assets**:
    The Docker setup serves the static frontend files from the `dist/` directory. You need to generate these files first.
    ```bash
    npm install
    npm run build
    ```

2.  **Create an Environment File**:
    The backend service requires an environment file.
    *   Navigate to the `server/` directory.
    *   Create a `.env` file. You can copy the `env.example` as a starting point.
    *   Fill in the necessary environment variables for your local setup (e.g., Square sandbox tokens).

3.  **Run Docker Compose**:
    From the root of the project, start the services:
    ```bash
    docker-compose up
    ```

    To run in the background (detached mode):
    ```bash
    docker-compose up -d
    ```

The application will be available at `http://localhost:8080`.
The backend API will be running on port `3000`.