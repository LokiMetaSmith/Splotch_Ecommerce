# Self-Hosting Deployment Guide

This guide provides instructions for deploying the application. It covers a recommended modern architecture as well as specific guides for different platforms.

## Recommended Architecture: Decoupled Frontend & Backend

Splitting the frontend (the visual website) and the backend (the "payment server") is a common and highly recommended modern web development practice. This architecture is often called a "decoupled" or "headless" setup.

### Why This is a Great Idea

1.  **✅ Cost-Effectiveness:** You can host your frontend on services that are specifically designed for static sites, many of which have extremely generous **free tiers** (like Vercel, Netlify, or Cloudflare Pages). You then only need to pay for a small, efficient server for your backend, potentially saving you money.
2.  **✅ Performance:** Frontend hosting services use global Content Delivery Networks (CDNs). This means your website's HTML, CSS, and JavaScript are stored on servers all around the world, making it load almost instantly for your users, no matter where they are.
3.  **✅ Scalability:** The frontend and backend can be scaled independently. If your website gets a million visitors but only a hundred of them make a purchase, the free static hosting can handle the traffic effortlessly, and your small backend server only has to work on the actual orders.
4.  **✅ Better Security:** Your user-facing website is just static files, which are very difficult to attack. You can concentrate your security efforts on the backend API, which isn't directly exposed.

### How It Works: The New Architecture

Here’s what the new plan would look like:

**Part 1: The Frontend (Your Website)**

*   **What it is:** The `dist/` folder that gets created after you run `npm run build`. It's just HTML, CSS, and JavaScript files.
*   **Where it will live:** On a **Static Hosting Platform**.
*   **Top Options (with great free tiers):**
    *   **Vercel:** Incredibly fast, zero-configuration deployments from GitHub.
    *   **Netlify:** Another fantastic option, very similar to Vercel with a rich feature set.
    *   **Cloudflare Pages:** Known for its massive global network and performance.

You would connect your GitHub repository to one of these services. Every time you push a change, they will automatically run your `npm run build` command and deploy the new `dist/` folder to their global CDN.

**Part 2: The Backend (Your "Payment Server")**

*   **What it is:** Your Node.js application (the `server` directory).
*   **Where it will live:** On a **VPS (Virtual Private Server)** like DigitalOcean, Linode, or AWS Lightsail. This is because it's a long-running process that needs to access a persistent filesystem for your `db.json` and `uploads/` folder.
*   **How it's accessed:** You would give it its own domain, typically a subdomain like `api.yourdomain.com`.

### The Critical Piece: CORS

When you split your frontend and backend onto different domains, you will run into a browser security feature called **CORS (Cross-Origin Resource Sharing)**.

By default, a web browser will block a script on `www.yourdomain.com` from making an API request to `api.yourdomain.com`. To make this work, you need to tell your backend server that it's okay to accept requests from your frontend's domain.

This is a simple fix in your Node.js/Express application by using the `cors` package:

1.  **Install the package:** `npm install cors` in your `server` directory.
2.  **Use it in your `server/index.js`:**
    ```javascript
    const express = require('express');
    const cors = require('cors'); // Import the package
    const app = express();

    // Whitelist your frontend's domain
    const corsOptions = {
      origin: 'https://www.your-frontend-domain.com' // The URL of your Vercel/Netlify site
    };

    app.use(cors(corsOptions)); // Enable CORS

    // ... the rest of your server code
    ```

### Our New Recommended Plan

1.  **Backend:** Deploy your `server` directory to a **$6/mo DigitalOcean Droplet**. We'll set it up at `api.yourdomain.com` and configure CORS.
2.  **Frontend:** Connect your GitHub repository to **Vercel (or Netlify)** and deploy your frontend to their free tier. We'll point `www.yourdomain.com` to it.
3.  **Code Change:** You'll need to update your frontend code so that instead of making API calls to `/api/...`, it makes them to the full URL `https://api.yourdomain.com/api/...`.

This architecture is powerful, professional, and cost-effective.

-----

## Deployment Guide 1: Proxmox / Local Server

This method is for users who want to host the application on a server in their own home or office network. The first step is to set up a reverse proxy, which acts as the "traffic cop" for your server.

### What is a Reverse Proxy?

Think of a reverse proxy like a **receptionist in an office building**. 🏢

Without one, you'd have to give everyone the exact room number for every person and department. If a department moves, all your contacts are broken.

With a receptionist (the reverse proxy), you just need one address: the building's main entrance. You tell the receptionist, "I need to speak to the Print Shop app," and they know exactly which internal room (or container) to connect you to.

The receptionist also handles security, checking IDs and ensuring only legitimate traffic gets through. This is what Nginx Proxy Manager does by managing your domain names and handling HTTPS encryption for you.

### Installing Nginx Proxy Manager (NPM)

The best way to run NPM is in its own dedicated, lightweight LXC container on Proxmox. This keeps it separate from your other applications for security and easier management.

**Step 1: Create a New LXC Container for NPM**

In your Proxmox web interface, create a new LXC container with these settings:

  * **Template:** `debian-12-standard` or `ubuntu-23.10-standard`. A minimal template is perfect.
  * **CPU Cores:** 1
  * **Memory:** 512 MB is fine, but 1024 MB is generous.
  * **Storage:** 8 GB
  * **Network:** Give it a **static IP address** on your local network (e.g., `192.168.1.10`). This is important so its address doesn't change.

**Step 2: Install Docker inside the LXC**

Once the LXC is running, open its console from the Proxmox UI.

1.  **Update the container:**
    ```bash
    apt update && apt upgrade -y
    ```
2.  **Install Docker:** The easiest way is using the official convenience script.
    ```bash
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    ```
3.  **Install Docker Compose:**
    ```bash
    apt install docker-compose -y
    ```

**Step 3: Create and Run the Nginx Proxy Manager Container**

1.  **Create a directory for your NPM data:**
    ```bash
    mkdir -p /opt/nginx-proxy-manager
    cd /opt/nginx-proxy-manager
    ```
2.  **Create a `docker-compose.yml` file:**
    ```bash
    nano docker-compose.yml
    ```
3.  **Paste the following configuration into the file:**
    ```yaml
    version: '3'
    services:
      app:
        image: 'jc21/nginx-proxy-manager:latest'
        restart: unless-stopped
        ports:
          - '80:80'
          - '81:81'
          - '443:443'
        volumes:
          - ./data:/data
          - ./letsencrypt:/etc/letsencrypt
    ```
4.  **Save the file** (`CTRL+X`, then `Y`, then `Enter`).
5.  **Start the container:**
    ```bash
    docker-compose up -d
    ```

### Initial Configuration

Nginx Proxy Manager is now running!

1.  **Access the Web UI:** Open a web browser and navigate to the IP address of your LXC container on port 81. Example: `http://192.168.1.10:81`
2.  **Default Login:**
      * **Email:** `admin@example.com`
      * **Password:** `changeme`
3.  **Change Your Password:** The first thing it will ask you to do is update your admin user details and, most importantly, set a secure password.

### Final Step: Port Forwarding

The last piece of the puzzle is to tell your internet router to send all web traffic to your new proxy.

1.  Log in to your router's administration page.
2.  Find the "Port Forwarding" or "Virtual Server" section.
3.  Create two new rules:
      * Forward external port **80** (HTTP) to the **internal IP** of your NPM container (e.g., `192.168.1.10`), port **80**.
      * Forward external port **443** (HTTPS) to the **internal IP** of your NPM container, port **443**.

Now your reverse proxy is fully set up and ready to direct traffic from the internet. Our next step will be to deploy your Print Shop application in its own container and then use the Nginx Proxy Manager UI to point your domain name to it.
