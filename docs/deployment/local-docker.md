# Local Development with Docker

This guide explains how to run the Print Shop application locally using Docker and Docker Compose. This approach provides a consistent, isolated environment that closely mimics a production container setup.

## Overview

The `docker-compose.yaml` file in the root of this project defines two services:
-   `backend`: The Node.js application server.
-   `frontend`: An Nginx server to serve the static frontend files.

### A Note on Podman

[Podman](https://podman.io/) is a daemonless container engine that can be used as a drop-in replacement for Docker. It is generally considered more secure as it does not require a persistent root-privileged daemon.

All commands in this guide that use `docker` and `docker-compose` can be replaced with `podman` and `podman-compose` respectively. For example, `docker-compose up` becomes `podman-compose up`. You may need to install `podman-compose` separately (`pip install podman-compose`).

On many Linux systems, you can even set a permanent alias to make the transition seamless:
`alias docker=podman`

## Prerequisites

Before you begin, ensure you have the following installed:
-   [Docker](https://www.docker.com/products/docker-desktop/)
-   [Node.js](https://nodejs.org/) and `npm` (for building the frontend)

## Setup Steps

1.  **Clone the Repository:**
    If you haven't already, clone the project to your local machine.
    ```bash
    git clone <your-repository-url>
    cd <project-folder>
    ```

2.  **Create Environment File:**
    The backend service requires an environment file for configuration.
    -   Navigate to the `server/` directory.
    -   Copy the example environment file:
        ```bash
        cp env.example .env
        ```
    -   Review the `server/.env` file and fill in the necessary values, especially for local development (e.g., Square Sandbox tokens). You can follow the setup guide in the main [README](../../README.md) for details on acquiring these keys.

3.  **Install Dependencies and Build Frontend:**
    The Docker container for the frontend needs the compiled static assets. These must be built on your host machine before starting the containers.
    ```bash
    # From the project root directory
    npm install
    npm run build
    ```
    This will create a `dist/` directory in the project root, which will be served by the Nginx container.

## Running the Application

Once the setup is complete, you can start the application.

1.  **Start the services:**
    Run the following command from the project root directory:
    ```bash
    docker-compose up --build
    ```
    -   The `--build` flag is recommended on the first run to ensure the images are built correctly.
    -   This will start both the backend and frontend containers. You will see logs from both services in your terminal.

2.  **Access the Application:**
    -   **Frontend:** Open your web browser and navigate to `http://localhost:8080`.
    -   **Backend API:** The API server is running on `http://localhost:3000`.

## Stopping the Application

To stop the containers, press `CTRL+C` in the terminal where `docker-compose` is running.

To stop the containers and remove the networks and volumes created, run:
```bash
docker-compose down
```
