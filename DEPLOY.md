# Production Deployment Guide

This guide provides a step-by-step process for deploying the Print Shop application to a production environment.

## 1. Production Server Setup

Before deploying the application, ensure your production server (e.g., a Linux VM from any cloud provider) is set up with the necessary software.

### Prerequisites
- **Node.js** (v18 or later)
- **npm** (comes with Node.js)
- **Nginx** (or another web server like Apache) to act as a reverse proxy.
- **PM2** (a process manager for Node.js) installed globally.
  ```bash
  npm install -g pm2
  ```
- **Git**

## 2. Code Deployment & Preparation

Next, get the application code onto the server and install dependencies.

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/LokiMetaSmith/lokimetasmith.github.io.git
    cd lokimetasmith.github.io
    ```
    *Note: In a real-world scenario, you would pull from your own repository.*

2.  **Install Dependencies:**
    - **Root Dependencies (for the build process):**
      ```bash
      npm install
      ```
    - **Backend Dependencies:**
      ```bash
      cd server
      npm install --production
      cd ..
      ```

3.  **Build the Frontend:**
    This command compiles all frontend assets into the `dist/` directory.
    ```bash
    npm run build
    ```

## 3. Configuration

This is the most critical part of the setup, involving the web server, environment variables, and data persistence.

### Nginx Configuration (as Reverse Proxy)

Configure Nginx to serve the static frontend and forward API requests to the backend.

1.  Create a new Nginx configuration file (e.g., `/etc/nginx/sites-available/printshop`).
2.  Add a server block. A basic configuration looks like this:

    ```nginx
    server {
        listen 80;
        server_name your_domain.com; # Replace with your domain

        # Path to your frontend build
        root /path/to/your/project/dist;
        index index.html;

        location / {
            try_files $uri $uri/ =404;
        }

        # Reverse proxy for API calls
        location /api/ {
            proxy_pass http://localhost:3000; # Assumes backend runs on port 3000
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }

        # Also proxy other specific backend paths
        location /uploads/ {
            proxy_pass http://localhost:3000/uploads/;
        }
        location /auth/ {
             proxy_pass http://localhost:3000/auth/;
        }
         location /oauth2callback {
             proxy_pass http://localhost:3000/oauth2callback;
        }
    }
    ```
3.  Enable the site and restart Nginx.
4.  **Crucially, set up HTTPS using Let's Encrypt / Certbot** or another SSL provider. Nginx configurations for HTTPS (port 443) are widely available.

### Environment Variables

In production, **do not use a `.env` file**. Set environment variables using your hosting provider's interface or your server's operating system (e.g., systemd service files, `/etc/environment`).

**Required Variables:**
- `PORT`: The port for the backend server (e.g., 3000).
- `BASE_URL`: The full public URL of your application (e.g., `https://your_domain.com`).
- `NODE_ENV`: Must be set to `production`.
- `SQUARE_ACCESS_TOKEN`: Your **production** Square access token.
- `SQUARE_LOCATION_ID`: Your **production** Square location ID.
- `GOOGLE_CLIENT_ID`: Your Google OAuth Client ID.
- `GOOGLE_CLIENT_SECRET`: Your Google OAuth Client Secret.
- `ADMIN_EMAIL`: Email address for receiving admin notifications.
- `RP_ID`: The Relying Party ID for WebAuthn (your domain, e.g., `your_domain.com`).
- `EXPECTED_ORIGIN`: The expected origin for WebAuthn requests (e.g., `https://your_domain.com`).
- `JWT_PRIVATE_KEY`: Your private RSA key for signing JWTs, formatted as a single line with `\n`.
- `JWT_PUBLIC_KEY`: Your public RSA key for verifying JWTs.
- `JWT_SECRET`: A 32-character secret for database encryption.
- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token.
- `TELEGRAM_CHANNEL_ID`: Your Telegram channel ID.
- `CSRF_SECRET`: A long, random string for CSRF protection.
- `SESSION_SECRET`: A long, random string for Express sessions.
- `DB_PATH`: The absolute path to your database file (e.g., `/var/data/db.json`).

### Data Persistence

The application stores state in two places. You **must** ensure these are persisted across deployments and backed up regularly.
- **Database:** The `db.json` file. It's recommended to store this outside the project directory (e.g., in `/var/data/db.json` and point to it with the `DB_PATH` env var).
- **File Uploads:** The `server/uploads/` directory.

## 4. Launching the Application

Use `pm2` to run the backend server as a persistent background service.

1.  **Navigate to the server directory:**
    ```bash
    cd /path/to/your/project/server
    ```
2.  **Start the server with PM2:**
    ```bash
    pm2 start index.js --name "print-shop-backend"
    ```
    PM2 will now manage the process, including restarting it on crashes or server reboots.

3.  **Save the PM2 process list:**
    ```bash
    pm2 save
    ```
    This ensures your process will be resurrected on server restarts.

Your application is now deployed. You can monitor the backend service using `pm2 status` or `pm2 logs print-shop-backend`.
