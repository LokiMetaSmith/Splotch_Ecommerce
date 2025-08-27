# Staging Environment Guide

This guide explains how to set up and manage the staging environment for the Print Shop application. The staging environment runs in Docker containers, making it isolated and easy to manage.

## Overview

The staging environment is a near-production replica of the application, designed for:
- Testing new features before deploying to production.
- Demonstrating changes to stakeholders.
- Running end-to-end tests against a realistic dataset.

It consists of two services defined in `docker-compose.yml`:
- `frontend`: An Nginx server for the static frontend application.
- `backend`: The Node.js server.

## Prerequisites

- [Docker](https://www.docker.com/get-started) and [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js](https://nodejs.org/) (for running helper scripts)
- A copy of the production `db.json` file.

## First-Time Setup

1.  **Install Dependencies:**
    Run `npm install` in the root directory to ensure all dependencies, including those for the helper scripts, are installed.

2.  **Configure Environment Variables:**
    The staging backend requires its own set of environment variables.
    ```bash
    # From the staging/ directory
    cp server/.env.example server/.env
    ```
    Now, edit `staging/server/.env` and fill in the required values. **Use sandbox/test credentials for all services (Square, Google, etc.).** Do not use production keys.

3.  **Prepare Production Data:**
    - Place a copy of the production `db.json` file into the `server/` directory at the root of the project.
    - Run the sanitization script to create a safe, anonymized version for staging:
    ```bash
    node staging/sanitize_data.js
    ```
    This will create a `db.staging.json` file inside `staging/server/`. The staging server is configured to use this file.

## Managing the Staging Environment

All management scripts should be run from the **root of the project directory**.

#### Deploying or Updating Staging

The `deploy.sh` script handles everything needed to get the environment running. It will:
- Build the latest version of the frontend.
- Copy all necessary frontend and backend files.
- Start (or restart) the Docker containers.

To run it:
```bash
./staging/deploy.sh
```

#### Stopping the Staging Environment

To stop the running Docker containers:
```bash
(cd staging && docker-compose down)
```

## Accessing the Staging Services

Once deployed, the services are available at:

-   **Frontend Application:** [http://localhost:8080](http://localhost:8080)
-   **Backend API:** [http://localhost:3000](http://localhost:3000)
