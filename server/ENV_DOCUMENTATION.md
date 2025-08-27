# Environment Variables

This document explains the environment variables used in this project. These variables are defined in a `.env` file in the `server/` directory. You can use the `env.example` file as a template.

## Server Configuration

-   `PORT`: The port on which the server will run. Defaults to `3000`.
-   `BASE_URL`: The base URL of the frontend application. This is used for CORS, constructing magic links for email login, and other security configurations.
-   `NODE_ENV`: The node environment. Set to `production` for production environments. This affects things like cookie security and CORS settings.

## Square Credentials

-   `SQUARE_ACCESS_TOKEN`: Your Square Sandbox access token. This is required for processing payments.
-   `SQUARE_LOCATION_ID`: Your Square Sandbox location ID. This is required for processing payments.

## Google OAuth Credentials

-   `GOOGLE_CLIENT_ID`: Your Google API client ID. This is used for authenticating with Google to send emails and for Google login.
-   `GOOGLE_CLIENT_SECRET`: Your Google API client secret.
-   `GMAIL_REFRESH_TOKEN`: The refresh token for the GMail API. This is obtained after the admin authenticates for the first time and is used to send emails. It is stored in `db.json` after the first authentication, but can be set here as a backup.

## Admin Configuration

-   `ADMIN_EMAIL`: The email address of the administrator. This address receives notifications for new user registrations and critical server errors.

## WebAuthn Configuration

-   `RP_ID`: The Relying Party ID for WebAuthn (passkey) authentication. This should be the domain of your application (e.g., `example.com`).
-   `EXPECTED_ORIGIN`: The expected origin for WebAuthn authentication requests. This should be the full URL of your frontend application (e.g., `https://www.example.com`).

## Telegram Bot Configuration

-   `TELEGRAM_BOT_TOKEN`: The token for your Telegram bot. The bot is used to send notifications about new orders and order status updates.
-   `TELEGRAM_CHANNEL_ID`: The ID of the Telegram channel where the bot will send messages.

## Security and Session Management

-   `SESSION_SECRET`: A secret key for signing the session ID cookie.
-   `CSRF_SECRET`: A secret key for CSRF protection.
-   `JWT_PRIVATE_KEY`: The private key for signing JSON Web Tokens (JWTs). If not provided, a new key will be generated on server startup. The key should be in PEM format.
-   `JWT_PUBLIC_KEY`: The public key for verifying JSON Web Tokens (JWTs). If not provided, a new key will be generated on server startup. The key should be in PEM format.
-   `JWT_SECRET`: A secret key for encrypting the `db.json` file. Must be 32 bytes.
-   `ENCRYPT_CLIENT_JSON`: A boolean (`true` or `false`) that controls whether the `db.json` file is encrypted on disk.
