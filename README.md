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
npm install

# For the server
cd server
npm install
cd ..
```

#### 3. Set Up Third-Party Services
You will need API keys and credentials from three services:

* **Square**: Go to the [Square Developer Dashboard](https://developer.squareup.com/apps). Get your **Sandbox Access Token** and **Sandbox Location ID**.
* **Google Cloud**: Go to the [Google Cloud Console](https://console.cloud.google.com/).
    * Create a new project.
    * Enable the **Gmail API**.
    * Create **OAuth 2.0 Credentials** for a "Web application".
    * Add `http://localhost:3000/oauth2callback` as an **Authorized redirect URI**.
    * Copy your **Client ID** and **Client Secret**.
* **SendGrid**: Create an account at [SendGrid](https://sendgrid.com) and generate an **API Key** for sending emails.

#### 4. Generate Security Keys
This application uses an RS256 key pair to sign server session tokens. Generate these keys in your terminal:

```bash
# Generate a 2048-bit private key
openssl genrsa -out private.pem 2048

# Extract the public key
openssl rsa -in private.pem -pubout -out public.pem
```

#### 5. Create Your Environment File
Create a file named `.env` in the `server/` directory and add the following variables.

```env
# server/.env

# --- Server Configuration ---
# The port the backend server will run on.
PORT=3000
# The base URL of the frontend application, used for creating links in emails.
BASE_URL="http://localhost:5173"


# --- Square Credentials ---
# Your Square Sandbox Access Token for processing payments.
SQUARE_ACCESS_TOKEN="YOUR_SANDBOX_ACCESS_TOKEN"
# Your Square Sandbox Location ID.
SQUARE_LOCATION_ID="YOUR_SANDBOX_LOCATION_ID"


# --- Google OAuth Credentials ---
# The Client ID for your Google Cloud OAuth 2.0 application.
GOOGLE_CLIENT_ID="YOUR_GOOGLE_CLIENT_ID"
# The Client Secret for your Google Cloud OAuth 2.0 application.
GOOGLE_CLIENT_SECRET="YOUR_GOOGLE_CLIENT_SECRET"


# --- SendGrid API Key ---
# API key for sending emails via SendGrid (if used as an alternative to Gmail).
SENDGRID_API_KEY="YOUR_SENDGRID_API_KEY"


# --- Admin Configuration ---
# The email address where error logs and notifications will be sent.
ADMIN_EMAIL="your-admin-email@example.com"


# --- WebAuthn (Security Key) Configuration ---
# The "Relying Party ID". For local development, this should be "localhost".
# For production, it must be the domain where the application is hosted.
RP_ID="localhost"
# The full origin URL of the frontend application.
EXPECTED_ORIGIN="http://localhost:5173"


# --- JWT Asymmetric Keys ---
# Copy the entire file content of your `private.pem`, including the header and footer,
# and format it as a single line with `\n` for newlines.
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
# Copy the entire file content of your `public.pem`.
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

#### 6. Place Legacy Scripts
The nesting feature relies on two older libraries. Place `clipper.js` and `parallel.js` inside the `public/lib/` directory at the root of your project.

## Running the Application

You will need to run the backend server and the frontend development server in two separate terminals.

#### 1. Start the Backend Server
```bash
# In a terminal, navigate to the server directory
cd server

# Start the server using the npm script
npm start
```
The backend server will be running at `http://localhost:3000`.

**Note:** The main server file is `server.js`, but the entry point for running the server is `index.js`, which is executed by the `npm start` command. Do not run `node server.js` directly.

#### 2. Start the Frontend Dev Server
```bash
# In a second terminal, from the root directory
npm run dev
```
The frontend application will be available at `http://localhost:5173`.

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

## Testing

This project includes both unit tests (using Jest) and end-to-end tests (using Playwright).

### Running All Tests

To run all tests, use the following command:

```bash
npm test
```

This will first run the unit tests, and then the end-to-end tests.

### Running Unit Tests

To run only the unit tests, use the following command:

```bash
npm run test:unit
```

### Running End-to-End Tests

To run only the end-to-end tests, use the following command:

```bash
npm run test:e2e
```

**Note:** The end-to-end tests require the development server to be running. Make sure you have the dev server running in a separate terminal with `npm run dev` before running the e2e tests.

## Deployment

For detailed deployment instructions, please see the [Deployment Guide](DEPLOY.md).
