# Deployment Guides

Welcome to the central deployment documentation for the Print Shop application. This guide will help you choose and execute the deployment strategy that best fits your needs.

There are several primary ways to deploy this application, each with its own guide:

### 1. Local Development

- **Use Case:** For developers contributing to the project. This is the standard way to run the application on your local machine for coding and testing.
- **📚 [Guide: Local Development Setup](../../README.md)**
  - _This link points to the main project README, which contains the setup instructions._

### 2. Local Docker Development

- **Use Case:** For a consistent and isolated local development environment using containers. It mirrors a production Docker setup more closely than the standard local development method.
- **📚 [Guide: Local Docker Development](./local-docker.md)**

### 3. Home Lab / Proxmox Deployment

- **Use Case:** For self-hosting the application on your own hardware, such as a home server running Proxmox or a similar virtualization platform.
- **📚 [Guide: Home Lab / Proxmox Deployment](./homelab-proxmox.md)**

### 4. Remote Cloud VPS Deployment

- **Use Case:** For deploying the application to a production environment on a cloud provider like DigitalOcean, AWS, or Vultr.
- **📚 [Guide: Remote Cloud VPS Deployment](./remote-vps.md)**

### 5. Single Board Computer (SBC) / On-Premises Production Deployment

- **Use Case:** For running the production stack on dedicated hardware (e.g., GMKtec N150) utilizing systemd services, Cloudflare Tunnels, and automated restart scripts (`restart.sh`).
- **📚 [Guide: SBC Provisioning & Hardware Deployment](../sbc-provisioning.md)**

### 6. Deployment Planning

- **Use Case:** To understand resource requirements and recommended deployment tiers (Lite vs Standard).
- **📚 [Guide: Plan Recommendations](./plan-recommendations.md)**

### 7. Reverse Proxy Guide

- **Use Case:** General information about using a reverse proxy (Caddy, Nginx) for security and SSL.
- **📚 [Guide: Using a Reverse Proxy](./reverse-proxy.md)**

### 8. DNS & Environments

- **Use Case:** Setting up multiple environments (Production, Development) and configuring DNS.
- **📚 [Guide: DNS & Environments](./dns-and-environments.md)**

Please choose the guide that matches your deployment target.
