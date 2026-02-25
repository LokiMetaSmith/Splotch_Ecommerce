# Deployment Plan Recommendation

This document outlines the recommended DigitalOcean Droplet sizes and configurations for deploying the Print Shop application. We offer two primary deployment tiers: **Lite** and **Standard**.

## 1. Lite Tier (Recommended for New Starts & Low Cost)

The **Lite** tier is optimized for cost-efficiency and is suitable for small shops, testing, or environments with low traffic. It uses a consolidated architecture to minimize resource usage.

*   **Cost:** ~$6/mo
*   **Droplet Size:** `s-1vcpu-1gb` (1GB RAM, 1 vCPU)
*   **Architecture:**
    *   **Database:** LowDB (File-based JSON database). Extremely lightweight but not suitable for high-concurrency writes.
    *   **Services:** Runs the Web Server and Telegram Bot in a single container.
    *   **Redundancy:** Single instance (no replicas).
*   **Use Case:**
    *   Small print shops with low order volume.
    *   Testing and development environments.
    *   Users who want to minimize hosting costs.

**To Deploy Lite Tier:**
```bash
./scripts/deploy-digitalocean.sh my-print-shop-lite --lite
```

---

## 2. Standard Tier (Recommended for Production)

The **Standard** tier is designed for robustness, scalability, and higher traffic. It uses enterprise-grade components.

*   **Cost:** ~$12/mo
*   **Droplet Size:** `s-1vcpu-2gb` (2GB RAM, 1 vCPU)
*   **Architecture:**
    *   **Database:** MongoDB. Robust, scalable, and handles high concurrency.
    *   **Services:** Runs Web Server and Telegram Bot in separate, specialized containers.
    *   **Redundancy:** Runs 2 replicas of the application server for high availability.
*   **Use Case:**
    *   Active print shops with regular traffic.
    *   Mission-critical deployments requiring higher uptime guarantees.
    *   Future-proofing for growth.

**To Deploy Standard Tier:**
```bash
./scripts/deploy-digitalocean.sh my-print-shop-prod
```

## Summary of Trade-offs

| Feature | Lite Tier ($6/mo) | Standard Tier ($12/mo) |
| :--- | :--- | :--- |
| **RAM** | 1 GB | 2 GB |
| **Database** | LowDB (File/JSON) | MongoDB |
| **Concurrency** | Limited (File Locking) | High |
| **Availability** | Single Instance | High (2 Replicas) |
| **Complexity** | Low | Medium |

**Recommendation:** Start with the **Lite** tier if you are just launching or have a limited budget. You can upgrade to the Standard tier later by migrating your data from LowDB to MongoDB and resizing your Droplet.
