# Environment Variables

This document explains the environment variables used in this project. These variables are defined in a `.env` file in the `server/` directory. You can use the `env.example` file as a template.

## Server Configuration

-   `PORT`: The port on which the server will run. Defaults to `3000`.
-   `BASE_URL`: The base URL of the frontend application. This is used for CORS, constructing magic links for email login, and other security configurations.
-   `NODE_ENV`: The node environment. Set to `production` for production environments. This affects things like cookie security and CORS settings.

## Square Credentials

-   `SQUARE_ENVIRONMENT`: Set to `production` for live transactions or `sandbox` for testing. Defaults to `sandbox`.
-   `SQUARE_ACCESS_TOKEN`: Your Square access token. This is required for processing payments.
-   `SQUARE_LOCATION_ID`: Your Square location ID. This is required for processing payments.

## Google OAuth Credentials

> **Note:** The redirect URI used for OAuth is automatically constructed as `{BASE_URL}/oauth2callback`. Ensure this URI is added to your Authorized Redirect URIs in the Google Cloud Console.


-   `GOOGLE_CLIENT_ID`: Your Google API client ID. This is used for authenticating with Google to send emails and for Google login.
-   `GOOGLE_CLIENT_SECRET`: Your Google API client secret.
-   `GMAIL_REFRESH_TOKEN`: The refresh token for the GMail API. This is obtained after the admin authenticates for the first time and is used to send emails. It is stored in `db.json` after the first authentication, but can be set here as a backup.

## Storage Configuration (Optional)

By default, files are stored locally in the `server/uploads` directory. To use S3-compatible object storage, configure the following:

-   `STORAGE_PROVIDER`: Set to `s3` to enable object storage. Defaults to `local`.
-   `S3_BUCKET`: The name of your S3 bucket.
-   `S3_REGION`: The region of your S3 bucket (e.g., `us-east-1`).
-   `S3_ENDPOINT`: (Optional) The endpoint URL for non-AWS S3 providers (e.g., `https://nyc3.digitaloceanspaces.com`).
-   `AWS_ACCESS_KEY_ID`: Your AWS or S3 provider access key ID.
-   `AWS_SECRET_ACCESS_KEY`: Your AWS or S3 provider secret access key.

## Agentic Payments / Machine-to-Machine Checkout (Optional)

Configuration for autonomous agent checkout processing via the Model Context Protocol (MCP) and x402/AP2 endpoints.

Because x402 and AP2 are open protocols rather than proprietary platforms, you do not obtain these keys from a single central authority. Instead, they are generated through your specific payment facilitator and your own server's cryptographic configuration.

-   `X402_MERCHANT_ID` & `X402_API_KEY`:
    - The x402 protocol is a negotiation standard built on the HTTP 402 status code. It is not a payment system itself.
    - These keys are issued by the facilitator you select to handle payment verification and settlement.
    - **Square/Block:** Because you are using Square, you will replace these generic variables with your existing Square Merchant ID and a Square API Token generated from your Square Developer Dashboard.
    - **Coinbase:** If you use Coinbase Developer Platform (CDP) as your mainnet facilitator, you will generate these API keys by creating a CDP account.
    - **Stripe:** If using Stripe, you will use your standard Stripe Account ID and Secret Key after requesting access to the "Stablecoins and Crypto" machine payments feature.
-   `AP2_GOVERNANCE_PUBKEY`:
    - Google's AP2 protocol relies on SD-JWT verifiable digital credentials to prove an agent's authority. You **generate this key yourself**.
    - You must create an asymmetric cryptographic key pair (e.g., RSA or ECDSA) for your server.
    - Your server uses the private key to sign AP2 payment intents, known as Checkout JWTs.
    - The `AP2_GOVERNANCE_PUBKEY` is the public half of that pair. You configure this environment variable to verify incoming agent mandates, and you must expose it publicly at your domain's `/.well-known/ap2` endpoint so shopping agents and payment rails can verify your store.

## Odoo Integration (Optional)

To enable integration with Odoo for inventory management or other features:

-   `ODOO_URL`: The URL of your Odoo instance (e.g., `https://your-odoo-instance.com`).
-   `ODOO_DB`: The name of your Odoo database.
-   `ODOO_USERNAME`: The username for Odoo authentication.
-   `ODOO_PASSWORD`: The password (or API key) for Odoo authentication.

## Error Tracking (Optional)

-   `SENTRY_DSN`: The Data Source Name (DSN) for Sentry error tracking. If provided, server errors will be reported to Sentry.

## Redis Configuration (Optional)

For production environments, Redis is recommended for session storage and rate limiting.

-   `REDIS_URL`: The connection string for your Redis instance (e.g., `redis://localhost:6379`).

## Admin Configuration

-   `ADMIN_EMAIL`: The email address of the administrator. This address receives notifications for new user registrations and critical server errors.

## WebAuthn Configuration

-   `RP_ID`: The Relying Party ID for WebAuthn (passkey) authentication. This should be the domain of your application (e.g., `example.com`).
-   `EXPECTED_ORIGIN`: The expected origin for WebAuthn authentication requests. This should be the full URL of your frontend application (e.g., `https://www.example.com`).

## Telegram Bot Configuration

-   `TELEGRAM_BOT_TOKEN`: The token for your Telegram bot. The bot is used to send notifications about new orders and order status updates.
-   `TELEGRAM_CHANNEL_ID`: The ID of the Telegram channel where the bot will send messages.

## Shipment Tracking

-   `EASYPOST_API_KEY`: Your API key from [EasyPost](https://www.easypost.com/). This is required to enable automatic shipment tracking, which updates an order's status to "DELIVERED" when the package arrives. If this key is not provided, the shipment tracking feature will be disabled.

## Reverse Proxy

-   `TRUST_PROXY`: Set to `true` if you are running the application behind a reverse proxy. This is important for rate limiting and security features to work correctly with the original client IP address. See `docs/deployment/reverse-proxy.md` for more details.

## Security and Session Management

-   `SESSION_SECRET`: A secret key for signing the session ID cookie.
    -   **Required in Production.**
    -   In development (when `NODE_ENV` is not `production`), a default weak secret is used if this is not set.
    -   Generate a strong random string (e.g., `openssl rand -base64 32`) for production use.
-   `CSRF_SECRET`: A secret key for CSRF protection.
-   `JWT_PRIVATE_KEY`: The private key for signing JSON Web Tokens (JWTs). If not provided, a new key will be generated on server startup. The key should be in PEM format.
-   `JWT_PUBLIC_KEY`: The public key for verifying JSON Web Tokens (JWTs). If not provided, a new key will be generated on server startup. The key should be in PEM format.
-   `JWT_SECRET`: A secret key for encrypting the `db.json` file. Must be 32 bytes.
-   `ENCRYPT_CLIENT_JSON`: A boolean (`true` or `false`) that controls whether the `db.json` file is encrypted on disk.

## Automated Backups

-   `BACKUP_ENABLED`: A boolean (`true` or `false`) indicating whether scheduled automatic database and upload backups are enabled. Defaults to `true`.
-   `BACKUP_METHOD`: The backup strategy to execute (`local`, `rclone`, `rsync`, or `s3`). Defaults to `local`.
-   `BACKUP_DESTINATION`: The target directory or remote endpoint for backups (e.g. `./backups`).
-   `BACKUP_RETENTION_DAYS`: Number of days to retain backup archives before pruning expired archives. Defaults to `30`.
-   `BACKUP_INTERVAL_HOURS`: Interval in hours between scheduled automatic backup runs. Defaults to `24`.

