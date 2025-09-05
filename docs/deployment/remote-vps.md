# Remote Cloud VPS Deployment

This guide covers deploying the Print Shop application to a production environment on a remote Virtual Private Server (VPS) from a cloud provider like DigitalOcean, Vultr, Linode, or AWS.

We present two methods:
1.  **Automated Deployment with Cloud-Init (Recommended):** This method uses a script to automate the entire server setup process. It's fast, repeatable, and based on Docker.
2.  **Manual Deployment (Legacy):** This is a traditional, non-containerized guide for setting up the application step-by-step.

---

## Method 1: Automated Deployment with Cloud-Init (Recommended)

This is the fastest and most reliable way to deploy the application.

### What is Cloud-Init?
Cloud-init is the industry-standard method for cross-platform cloud instance initialization. It allows you to provide a configuration script when you create a server, which will be executed on its first boot to install software, create files, and set up users automatically. Our repository includes a pre-built `cloud-config.example.yml` file for this purpose.

### Step 1: Customize the Configuration

1.  **Make a copy:** In the root of the project, copy `cloud-config.example.yml` to a new file named `my-cloud-config.yml`. **Do not commit `my-cloud-config.yml` to git**, as it will contain your secrets.
2.  **Add your SSH Key:** Open `my-cloud-config.yml` and replace `ssh-rsa AAAA... your_ssh_public_key` with your own public SSH key. This is how you will log into the server later.
3.  **Fill in your secrets:** Scroll down to the `write_files` section. Under the file path `/home/loki/lokimetasmith.github.io/.env`, you must replace all placeholder values (like `YOUR_DROPLET_IP`, `YOUR_PRODUCTION_SQUARE_TOKEN`, etc.) with your actual production keys and secrets.

### Step 2: Launch the Server (DigitalOcean Example)

1.  Log in to your [DigitalOcean](https://www.digitalocean.com/) account.
2.  Click **Create -> Droplet**.
3.  **Choose an image:** Select **Ubuntu 22.04 (LTS) x64**.
4.  **Choose a plan:** A basic shared CPU droplet is a good starting point.
5.  **Authentication:** Ensure your SSH key (the same one you added to the config file) is selected.
6.  **Select additional options:** Check the box for **User Data**.
7.  **Provide User Data:** A text box will appear. Copy the *entire contents* of your customized `my-cloud-config.yml` file and paste it into this box.
8.  Finalize the droplet details (hostname, etc.) and click **Create Droplet**.

DigitalOcean will now create the server. On its first boot, it will automatically execute your script. This may take 3-5 minutes.

### Step 3: Post-Deployment Steps

1.  **Point your Domain:** Once the droplet is created, find its public IP address. Go to your domain registrar and create an **A record** that points your desired domain (e.g., `print-shop.yourdomain.com`) to this IP address.

2.  **Setting up HTTPS (Manual Step):**
    The cloud-init script sets up an Nginx server on port 80 (HTTP). To enable HTTPS, you need to configure it manually.
    -   SSH into your new server: `ssh loki@YOUR_DROPLET_IP`
    -   You can use a tool like Certbot to obtain and install a free SSL certificate from Let's Encrypt for your Nginx container. Detailed guides for this are widely available online.

After these steps, your application will be live and running in a containerized environment.

---

## Method 2: Manual Deployment (Legacy)

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

1.  **Navigate to the server directory:** `cd /path/to/your/project/server`
2.  **Start the server:** `pm2 start index.js --name "print-shop-backend"`
3.  **Save the process list:** `pm2 save`

Your application is now deployed. Monitor it with `pm2 status` or `pm2 logs print-shop-backend`.
