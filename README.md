---
title: Splotch
layout: page
---

# Splotch

Splotch is a web application for creating and ordering custom prints.

## Development

To get started with local development, follow these steps:

1.  **Install Dependencies:**
    First, install the necessary npm packages.
    ```bash
    npm install
    ```

2.  **Run the Development Server:**
    This command will start the Vite development server, which provides hot module replacement and fast updates.
    ```bash
    npm run dev
    ```
    The application will be available at `http://localhost:5173`.

## Production Build

To create a production-ready build of the application, follow these steps:

1.  **Build the Application:**
    This command will bundle the application and output the static files to the `dist` directory.
    ```bash
    npm run build
    ```

2.  **Serve the Production Build:**
    This command will serve the contents of the `dist` directory. This is a simple way to preview the production build locally.
    ```bash
    npm run start
    ```
    The production build will be available at `http://localhost:3000` by default.

## Deployment

For detailed deployment instructions, please see the [Deployment Guide](DEPLOY.md).
