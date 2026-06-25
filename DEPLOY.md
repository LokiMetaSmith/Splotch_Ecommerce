# Deployment Guide

This guide provides instructions for deploying the Splotch application.

## Server Setup

### Prerequisites

- Node.js (v14 or later)
- npm

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/LokiMetaSmith/lokimetasmith.github.io.git
    cd lokimetasmith.github.io
    ```

2.  **Install server dependencies:**
    The server is located in the `server/` directory.
    ```bash
    cd server
    npm install
    ```

### Environment Variables

The server requires the following environment variables to be set. You can create a `.env` file in the `server/` directory to store these variables for local development. **Do not commit the `.env` file to version control.**

-   `SQUARE_ACCESS_TOKEN`: Your Square access token.
-   `SQUARE_ENVIRONMENT`: The Square environment to use (`sandbox` or `production`).
-   `JWT_SECRET`: A secret key for signing JSON Web Tokens.
-   `RP_ID`: The Relying Party ID for WebAuthn (e.g., `yourdomain.com`).
-   `EXPECTED_ORIGIN`: The expected origin for WebAuthn requests (e.g., `https://yourdomain.com`).
-   `BASE_URL`: The base URL of your application (e.g., `https://yourdomain.com`).
-   `PORT` (optional): The port for the server to listen on (defaults to 3000).

## Data Persistence

The server uses a `db.json` file for storing order and user data. This file is created automatically in the `server/` directory. It is recommended to back up this file regularly.

The server also stores uploaded images in the `server/uploads/` directory. This directory must be persisted across deployments.

## Running the Server

To start the server, run the following command from the `server/` directory:

```bash
npm start
```

## Local Development and Testing

When testing the application locally, you cannot simply open the `printshop.html` file in your browser. This will cause a CORS error because the browser will block the JavaScript file from being loaded from the local file system.

To avoid this, you need to serve the files from a local HTTP server. Here's how you can do it using the `serve` package:

1.  **Install `serve` globally:**
    ```bash
    npm install -g serve
    ```

2.  **Start the local server:**
    From the root of the project directory, run the following command:
    ```bash
    serve
    ```

3.  **Access the application:**
    Open the URL provided by the `serve` command in your browser (usually `http://localhost:3000`) and navigate to `printshop.html`.

## Production Considerations

For production deployments, consider the following:

-   **HTTPS:** Always run the application over HTTPS to protect sensitive data.
-   **Process Manager:** Use a process manager like `pm2` to keep the server running and to handle restarts.
-   **Environment Variables:** In a production environment, do not use a `.env` file. Instead, use your hosting provider's mechanism for managing environment variables.
-   **CORS:** For production, you should restrict the origin in the CORS configuration to only allow requests from the domain where your frontend is hosted.

## Frontend Build

The frontend assets need to be built before deployment.

1.  **Install frontend dependencies:**
    ```bash
    npm install
    ```

2.  **Build the assets:**
    ```bash
    npm run build
    ```

This will create a `dist/` directory with the compiled assets. You will need to serve the contents of this directory, along with `index.html` and other static files, from your web server.
