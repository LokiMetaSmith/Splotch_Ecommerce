# DNS & Environment Management Guide

This guide details how to configure your DNS and reverse proxy to support multiple environments (e.g., **Production** and **Development**) on a single server or across multiple servers.

## 1. DNS Strategy: Subdomains

The standard best practice for separating environments is to use **subdomains**. This allows you to host different versions of your application on the same domain but with distinct prefixes.

### Structure
*   **Production:** `example.com` (or `www.example.com`)
*   **Development:** `dev.example.com` (or `staging.example.com`)

### DNS Records (A Records)
You need to point both domain names to your server's public IP address.

| Type | Name | Content / Value | TTL |
| :--- | :--- | :--- | :--- |
| A | `@` (root) | `203.0.113.10` (Your Server IP) | 3600 |
| A | `dev` | `203.0.113.10` (Your Server IP) | 3600 |

*   **`@`**: Points the root domain (`example.com`) to your server.
*   **`dev`**: Points the subdomain (`dev.example.com`) to the **same** server IP.

## 2. Reverse Proxy Configuration

Your reverse proxy (Nginx or Caddy) listens on ports 80 and 443. It inspects the incoming request's "Host" header (`example.com` vs. `dev.example.com`) and routes traffic to the correct internal container.

### Option A: Nginx (Traditional & Robust)

You will need two separate `server` blocks in your Nginx configuration.

**Production Block (`example.com` -> `app-prod:3000`):**
```nginx
server {
    listen 80;
    server_name example.com www.example.com;

    location / {
        proxy_pass http://app-prod:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Development Block (`dev.example.com` -> `app-dev:3001`):**
```nginx
server {
    listen 80;
    server_name dev.example.com;

    location / {
        proxy_pass http://app-dev:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Option B: Caddy (Automatic HTTPS)

Caddy handles this much more simply. It automatically provisions SSL certificates for every domain block you define.

**Caddyfile:**
```caddy
example.com {
    reverse_proxy app-prod:3000
}

dev.example.com {
    reverse_proxy app-dev:3001
}
```

## 3. Docker Compose Setup

To run two instances of the application on the same server, you need to define them as separate services in your `docker-compose.yml`.

**Example `docker-compose.yml`:**

```yaml
version: '3.8'

services:
  # PRODUCTION INSTANCE
  app-prod:
    image: ghcr.io/lokimetasmith/print-shop:latest
    container_name: print-shop-prod
    restart: always
    environment:
      - NODE_ENV=production
      - PORT=3000
    # No ports mapping needed if using a reverse proxy in the same network
    networks:
      - web-net

  # DEVELOPMENT INSTANCE
  app-dev:
    image: ghcr.io/lokimetasmith/print-shop:dev
    container_name: print-shop-dev
    restart: always
    environment:
      - NODE_ENV=development
      - PORT=3001 # Internal port can be different, or same if containerized
    networks:
      - web-net

  # REVERSE PROXY (Nginx or Caddy)
  reverse-proxy:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - app-prod
      - app-dev
    networks:
      - web-net

networks:
  web-net:
```

## 4. Automation Scripts

We provide helper scripts to make this easier:

*   **`scripts/update-dns-record.sh`**: Quickly adds an A record for a subdomain using the DigitalOcean CLI (`doctl`).
*   **`scripts/generate-nginx-config.sh`**: Generates a valid Nginx server block for a new subdomain.

See the `scripts/` directory for usage instructions.
