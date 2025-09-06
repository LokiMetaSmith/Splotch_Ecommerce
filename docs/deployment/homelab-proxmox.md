# Home Lab Deployment with Proxmox and Containers

This guide provides comprehensive instructions for deploying the Print Shop application on a home server managed by Proxmox. We will use a container engine (like Docker or Podman) to run the application and Nginx Proxy Manager to handle secure, external access.

## Architecture Overview

We will create two separate, lightweight LXC containers on Proxmox:

1.  **Nginx Proxy Manager (NPM):** This container will act as our secure reverse proxy. It will manage our domain name, handle SSL certificates, and direct traffic to our application.
2.  **Print Shop App:** This container will run the actual application using Docker Compose.

This separation is a security best practice, as it isolates our public-facing proxy from the application itself.

---

## Part 1: Setting Up the Reverse Proxy

The first step is to set up Nginx Proxy Manager, which will act as the "traffic cop" for your server.

### What is a Reverse Proxy?

Think of a reverse proxy like a **receptionist in an office building**. 🏢

Without one, you'd have to give everyone the exact room number for every person and department. If a department moves, all your contacts are broken.

With a receptionist (the reverse proxy), you just need one address: the building's main entrance. You tell the receptionist, "I need to speak to the Print Shop app," and they know exactly which internal room (or container) to connect you to.

The receptionist also handles security, checking IDs and ensuring only legitimate traffic gets through. This is what Nginx Proxy Manager does by managing your domain names and handling HTTPS encryption for you.

### Installing Nginx Proxy Manager (NPM)

The best way to run NPM is in its own dedicated, lightweight LXC container on Proxmox.

**Step 1: Create a New LXC Container for NPM**

In your Proxmox web interface, create a new LXC container with these settings:

- **Template:** `debian-12-standard` or `ubuntu-23.10-standard`. A minimal template is perfect.
- **CPU Cores:** 1
- **Memory:** 512 MB is fine, but 1024 MB is generous.
- **Storage:** 8 GB
- **Network:** Give it a **static IP address** on your local network (e.g., `192.168.1.10`). This is important so its address doesn't change.

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

    > **Note on Podman:** As a more secure, daemonless alternative to Docker, you can install `podman` and `podman-compose` instead. The commands used in this guide are interchangeable.

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
    version: "3"
    services:
      app:
        image: "jc21/nginx-proxy-manager:latest"
        restart: unless-stopped
        ports:
          - "80:80"
          - "81:81"
          - "443:443"
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

1.  **Access the Web UI:** Open a web browser and navigate to the IP address of your NPM container on port 81. Example: `http://192.168.1.10:81`
2.  **Default Login:**
    - **Email:** `admin@example.com`
    - **Password:** `changeme`
3.  **Change Your Password:** The first thing it will ask you to do is update your admin user details and, most importantly, set a secure password.

### Final Step: Port Forwarding

The last piece of the puzzle is to tell your internet router to send all web traffic to your new proxy.

1.  Log in to your router's administration page.
2.  Find the "Port Forwarding" or "Virtual Server" section.
3.  Create two new rules:
    - Forward external port **80** (HTTP) to the **internal IP** of your NPM container (e.g., `192.168.1.10`), port **80**.
    - Forward external port **443** (HTTPS) to the **internal IP** of your NPM container, port **443**.

Your reverse proxy is now fully set up and ready to direct traffic. The next step is to deploy the Print Shop application and connect it to the proxy.

---

## Part 2: Deploying the Print Shop Application

Now we will set up the container that will run the application itself.

**Step 1: Create a New LXC Container for the App**

In Proxmox, create a second LXC container with these settings:

- **Template:** `debian-12-standard` or `ubuntu-23.10-standard`.
- **CPU Cores:** 1-2 (depending on expected load)
- **Memory:** 1024 MB or more is recommended.
- **Storage:** 16 GB or more to accommodate the OS, Docker images, and application data.
- **Network:** Give it a **static IP address** on your local network (e.g., `192.168.1.20`).

**Step 2: Install Dependencies**

Open the console for your new app container.

1.  **Update the container:**
    ```bash
    apt update && apt upgrade -y
    ```
2.  **Install Docker, Docker Compose, Git, and Node.js/npm:**

    ```bash
    # Install Docker
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh

    # Install other tools
    apt install docker-compose git nodejs npm -y
    ```

    > **Note on Podman:** You can use `podman` and `podman-compose` here as well. The rest of the steps remain the same.

**Step 3: Prepare the Application**

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/LokiMetaSmith/lokimetasmith.github.io.git /opt/print-shop
    cd /opt/print-shop
    ```
2.  **Create the `.env` file:**
    - Navigate to the server directory: `cd server`
    - Copy the example file: `cp env.example .env`
    - **Edit the `.env` file (`nano .env`)** and fill in your production secrets and configuration.
    - `cd ..` to return to the project root.

3.  **Build the Frontend:**
    The application's `docker-compose.yaml` uses a pre-built frontend.
    ```bash
    # From the project root (/opt/print-shop)
    npm install
    npm run build
    ```

**Step 4: Launch the Application**

With all the files in place, start the application using Docker Compose.

```bash
# From the project root (/opt/print-shop)
docker-compose up -d
```

The application is now running. The frontend is accessible within your local network at `http://192.168.1.20:8080`.

---

## Part 3: Connecting the Domain with Nginx Proxy Manager

The final step is to tell your reverse proxy how to find your application and make it securely available online.

1.  **Log into Nginx Proxy Manager:**
    Open `http://<NPM_CONTAINER_IP>:81` (e.g., `http://192.168.1.10:81`).

2.  **Add a Proxy Host:**
    - Navigate to `Hosts` -> `Proxy Hosts`.
    - Click `Add Proxy Host`.

3.  **Configure the Details Tab:**
    - **Domain Names:** Enter the public domain you want to use (e.g., `print-shop.yourdomain.com`).
    - **Scheme:** `http`
    - **Forward Hostname / IP:** Enter the static IP of your **app container** (e.g., `192.168.1.20`).
    - **Forward Port:** `8080` (this is the port exposed by the `frontend` service in the `docker-compose.yaml`).
    - **Enable `Block Common Exploits`**.

4.  **Configure SSL:**
    - Click the **SSL** tab.
    - In the SSL Certificate dropdown, select **"Request a new SSL Certificate"**.
    - Enable **"Force SSL"** and **"HTTP/2 Support"**.
    - Agree to the Let's Encrypt Terms of Service.
    - Click `Save`.

Nginx Proxy Manager will now obtain an SSL certificate for your domain and automatically configure the proxy. After a minute or two, you should be able to access your application securely at `https://print-shop.yourdomain.com`.

---

## Part 4: Advanced Security & Performance with Cloudflare

The setup above provides a solid, working deployment. However, for a production environment that is exposed to the public internet, you can significantly improve security and performance by using [Cloudflare](https://www.cloudflare.com/).

This section outlines best practices for protecting your home server by routing your traffic through Cloudflare's network. This provides several key benefits:

- **Hides your Home IP Address:** Visitors connect to Cloudflare's servers, not directly to your home network.
- **DDOS Protection:** Cloudflare automatically absorbs malicious denial-of-service attacks.
- **CDN & Caching:** Your site's static assets are cached on Cloudflare's global network, making it load faster for users worldwide.

### Step 1: Move DNS to Cloudflare

1.  **Create a Cloudflare Account:** Sign up for a free account on the Cloudflare website.
2.  **Add Your Domain:** Follow the prompts to add your domain name. Cloudflare will automatically scan for your existing DNS records.
3.  **Update Nameservers:** Cloudflare will provide you with two new nameserver addresses. You must log in to your domain registrar (where you bought the domain) and replace your existing nameservers with the ones provided by Cloudflare. This change can take a few hours to propagate.
4.  **Enable the Proxy:** In your Cloudflare DNS settings, ensure the record pointing to your home IP address has the **Proxy status** set to **"Proxied"** (it should show an orange cloud icon). This is the magic step that routes traffic through Cloudflare.

### Step 2: Lock Down Your Network

Once your traffic is proxied through Cloudflare, you should prevent attackers from bypassing it and accessing your server directly.

1.  **Restrict Traffic to Cloudflare IPs:**
    - The most important step is to configure your home firewall (usually in your router settings) to **only allow incoming traffic on port 443 from Cloudflare's IP addresses**.
    - Block all other incoming traffic on this port. This ensures that no one can access your server by its direct IP address.
    - Cloudflare publishes its IP ranges here: [https://www.cloudflare.com/ips/](https://www.cloudflare.com/ips/).

2.  **Enforce HTTPS:**
    - In your router, you can now safely **remove the port forwarding rule for port 80**. Only forward port 443 to your Nginx Proxy Manager container.
    - In the Cloudflare dashboard for your domain, go to **SSL/TLS -> Overview**. Set the encryption mode to **Full (Strict)**. This ensures traffic is encrypted all the way from the user's browser to your server.
    - In **SSL/TLS -> Edge Certificates**, enable **"Always Use HTTPS"**.

### Step 3: Harden Your Server's SSH Access

Your web traffic is now secure, but you should also harden access to the server itself.

1.  **Use SSH Keys:** Ensure you are only logging in with SSH keys and have disabled password authentication.
2.  **Disable Root Login:** In your server's SSH configuration file (`/etc/ssh/sshd_config`), ensure you have the line `PermitRootLogin no`.
3.  **Restrict SSH Access (Optional):** For maximum security, you can configure your firewall to only allow SSH connections (port 22) from specific, trusted IP addresses.

### Step 4: Explore Advanced Features

With this setup, you can now explore other powerful Cloudflare features:

- **Dynamic DNS:** If your home IP address changes, you can use a script with the Cloudflare API to automatically update your DNS record, avoiding the need for a separate dynamic DNS service.
- **Firewall Rules:** Create custom rules in the Cloudflare dashboard to block traffic from specific countries, IP ranges, or known malicious actors.
- **Cloudflare Access:** Protect specific URLs or your entire site with an additional login layer (e.g., Google, GitHub, or one-time passcodes).
