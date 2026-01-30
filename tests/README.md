# Tests

This directory contains the unit tests for the Print Shop application.

## Current Tests

### `server.test.js`

*   Tests that the server is running and responds to the `/api/ping` endpoint.

### `server/auth.test.js`

*   Tests the authentication endpoints:
    *   `/api/auth/pre-register`
    *   `/api/auth/login`
    *   `/api/auth/login-verify`
    *   `/api/auth/register-verify`

### `orders.test.js`

*   Tests the order management endpoints:
    *   `/api/create-order`
    *   `/api/orders`
    *   `/api/orders/:orderId`
    *   `/api/orders/:orderId/status`

### `upload.test.js`

*   Tests the file upload endpoint:
    *   `/api/upload-design` (Including validation, file type checks, and SVG sanitization)

## Future Tests

*   Add tests for the encryption/decryption of the client JSON file.
*   Add tests for the Telegram bot.
*   Add tests for the `generateCutFile` function.
