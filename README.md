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
You will need to API keys and credentials from three services:

* **Square**: Go to the [Square Developer Dashboard](https://developer.squareup.com/apps). Get your **Sandbox Access Token** and **Sandbox Location ID**.
* **Google Cloud**: Go to the [Google Cloud Console](https://console.cloud.google.com/).
    * Create a new project.
    * Enable the **Gmail API**.
    * Create **OAuth 2.0 Credentials** for a "Web application".
    * Add `http://localhost:3000/oauth2callback` as an **Authorized redirect URI**.
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

## Generating a Gmail Refresh Token

To allow the application to send emails (like magic login links) via Gmail, you need to provide it with a valid OAuth 2.0 Refresh Token. Follow this two-step process to generate one.

### Prerequisites

Before you begin, ensure your `.env` file in this `server/` directory contains the following values from your Google Cloud project:

-   `GOOGLE_CLIENT_ID`
-   `GOOGLE_CLIENT_SECRET`
-   `GMAIL_REDIRECT_URI` (This must match one of the authorized redirect URIs in your Google Cloud project's credentials settings, e.g., `http://localhost:3000/oauth2callback`)

### Step 1: Generate an Authorization URL

First, you need to generate a unique URL that will allow you to grant the application permission to send emails on your behalf.

1.  Open your terminal and run the following command from the root of the project:

    ```bash
    node server/getAuthUrl.js
    ```

2.  The script will print a URL to your console. Copy this entire URL.

### Step 2: Get the Authorization Code and Refresh Token

Now, you will use the URL to get an authorization code from Google, which you will then exchange for the refresh token.

1.  Paste the URL from Step 1 into your web browser and navigate to it.

2.  You will be prompted to sign in to your Google account and then asked to grant permission for the application to "Send email on your behalf". Click "Allow".

3.  After you grant permission, your browser will be redirected to the `GMAIL_REDIRECT_URI` you specified in your `.env` file. The URL in your browser's address bar will look something like this:

    ```
    http://localhost:3000/oauth2callback?code=4/0A...Ag&scope=https://www.googleapis.com/auth/gmail.send
    ```

4.  Copy the `code` value from the URL. It's the long string of characters between `?code=` and `&scope`.

5.  Open the `server/getRefreshToken.js` file in your code editor.

6.  Paste the code you just copied into the `an_authorization_code` variable, replacing the placeholder text.

    ```javascript
    // server/getRefreshToken.js
    // ...
    const an_authorization_code = 'PASTE_THE_CODE_FROM_YOUR_BROWSER_URL_HERE';
    // ...
    ```

7.  Save the `getRefreshToken.js` file.

8.  Go back to your terminal and run the second script:

    ```bash
    node server/getRefreshToken.js
    ```

9.  The script will connect to Google and exchange the code for your tokens. It will print the refresh token to the console.

### Step 3: Update Your `.env` File

1.  Copy the refresh token that was printed to your console.

2.  Open your `server/.env` file.

3.  Paste the new token as the value for the `GMAIL_REFRESH_TOKEN` variable:

    ```
    GMAIL_REFRESH_TOKEN="1//...your-new-token...-Lg"
    ```

4.  Save the `.env` file.

The server is now fully configured to send emails. You will need to restart the server for these changes to take effect.

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
