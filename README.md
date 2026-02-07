# Print Shop Application - Getting Started

This guide provides instructions for setting up and running the Print Shop application locally for development.

## Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or later)
-   [npm](https://www.npmjs.com/)
-   [OpenSSL](https://www.openssl.org/) (usually pre-installed on Linux/macOS, available for Windows)

## Installation & Setup

#### 1. Clone the Repository
Clone this project to your local machine.
```bash
git clone <your-repository-url>
cd <your-project-folder>
```

#### 2. Install Dependencies
Install the necessary Node.js packages for both the server and the client.
```bash
# From the root directory
pnpm install

# For the server
cd server
pnpm install
cd ..
```

#### 3. Set Up Third-Party Services
You will need to API keys and credentials from three services:

* **Square**: Go to the [Square Developer Dashboard](https://developer.squareup.com/apps). Get your **Sandbox Access Token** and **Sandbox Location ID**.
* **Google Cloud**: Go to the [Google Cloud Console](https://console.cloud.google.com/).
    * Create a new project.
    * Enable the **Gmail API**.
    * Create **OAuth 2.0 Credentials** for a "Web application".
    * Under **Authorized redirect URIs**, add the public URI for your server's callback endpoint. This URI should be your `BASE_URL` followed by `/oauth2callback`. For example: `https://your-print-shop.com/oauth2callback`. For local development, use `http://localhost:3000/oauth2callback`.
    * Copy your **Client ID** and **Client Secret**.

#### 4. Generate Security Keys
This application uses an RS256 key pair to sign server session tokens. Generate these keys in your terminal:

```bash
# Generate a 2048-bit private key
openssl genrsa -out private.pem 2048

# Extract the public key
openssl rsa -in private.pem -pubout -out public.pem
```

#### 5. Create Your Environment File
Create a file named `.env` in the `server/` directory. You can use `server/env.example` as a template. For a detailed explanation of each environment variable, please see the [Environment Variable Documentation](server/ENV_DOCUMENTATION.md).

#### 6. Place Legacy Scripts
The nesting feature relies on two older libraries. Place `clipper.js` and `parallel.js` inside the `public/lib/` directory at the root of your project.

## Configuring Gmail API Access

The server is already equipped to handle the Google OAuth2 authentication process for sending emails. The following steps will guide you through using the built-in endpoints to authorize your application and automatically store the necessary refresh token.

### Step 1: Configure Your Environment Variables
Make sure your `server/.env` file is correctly configured with your Google API credentials:

-   `GOOGLE_CLIENT_ID`: Your Google API client ID.
-   `GOOGLE_CLIENT_SECRET`: Your Google API client secret.
-   `BASE_URL`: The public-facing URL of your server (e.g., `https://your-print-shop.com`). For local development, this should be `http://localhost:3000`.

### Step 2: Start Your Server
Run your print shop server as you normally would:
```bash
# In a terminal, from the project root
pnpm run start --prefix server
```

### Step 3: Authorize the Application
Once your server is running, open your web browser and navigate to the following URL:

[http://localhost:3000/auth/google](http://localhost:3000/auth/google)

This will redirect you to the Google consent screen. You will be asked to log in to your Google account and grant the application permission to send emails on your behalf.

### Step 4: Automatic Token Retrieval
After you grant permission, Google will redirect you back to your server's `/oauth2callback` endpoint. The server will automatically:

1.  Capture the authorization code from the URL.
2.  Exchange the code for an access token and a **refresh token**.
3.  Securely store the refresh token in your `server/db.json` file under `config.google_refresh_token`.

Your application is now fully configured to send emails. The server will use the stored refresh token to get new access tokens whenever it needs to send an email.

## Running the Application

You will need to run the backend server and the frontend development server in two separate terminals.

#### 1. Start the Backend Server
```bash
# In a terminal, navigate to the server directory
cd server

# Start the server using the npm script
pnpm start
```
The backend server will be running at `http://localhost:3000`.

**Note:** The main server file is `server.js`, but the entry point for running the server is `index.js`, which is executed by the `npm start` command. Do not run `node server.js` directly.

#### 2. Start the Frontend Dev Server
```bash
# In a second terminal, from the root directory
pnpm run dev
```
The frontend application will be available at `http://localhost:5173`.

## Production Build

To create a production-ready build of the application, follow these steps:

1.  **Build the Application:**
    This command will bundle the application and output the static files to the `dist` directory.
    ```bash
    pnpm run build
    ```

2.  **Serve the Production Build:**
    This command will serve the contents of the `dist` directory. This is a simple way to preview the production build locally.
    ```bash
    pnpm run start
    ```
    The production build will be available at `http://localhost:3000` by default.

## Testing

This project includes both unit tests (using Jest) and end-to-end tests (using Playwright).

### Running All Tests

To run all tests, use the following command:

```bash
pnpm test
```

This will first run the unit tests, and then the end-to-end tests.

### Running Unit Tests

To run only the unit tests, use the following command:

```bash
pnpm run test:unit
```

### Running End-to-End Tests

To run only the end-to-end tests, use the following command:

```bash
pnpm run test:e2e
```

**Note:** The end-to-end tests require the development server to be running. Make sure you have the dev server running in a separate terminal with `pnpm run dev` before running the e2e tests.

## Deployment

For detailed deployment instructions, please see the [Deployment Guide](DEPLOY.md).
