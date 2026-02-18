# Testing To-Do List

This section outlines critical issues and gaps in the project's automated testing suite. The items are prioritized based on their impact on application stability and correctness.

---

### **High-Priority: Critical Failures & Gaps**

These issues represent the most severe risks to the application's functionality and require immediate attention.

-   **[x] Fix Broken Test Environment (Dependencies & ESM):** The project is stuck in "dependency hell" with `jsdom` v27 requiring CommonJS but its transitive dependency `html-encoding-sniffer` v6 requiring ESM. This breaks global Jest tests like `svg_sanitization.test.js` and `server.test.js`. The environment must be repaired by either upgrading to a modern, ESM-compatible `jsdom` (v29+) or resolving the transitive dependency conflict.
-   **[x] Fix Test Execution Script:** The main test script (`run-tests.sh`) only executes Playwright E2E tests and **completely ignores all Jest unit and integration tests**. This script must be updated to run the entire test suite (e.g., by running `npm run test:unit && npm run test:e2e`).
-   **[x] Test the Payment & Order API Endpoints:** The backend API endpoints for creating orders and processing payments (`/api/create-order`) and managing orders (`/api/orders`, `/api/orders/:orderId`, etc.) have **zero test coverage**. These are the most critical, revenue-generating parts of the application and must have robust integration tests.
-   **[x] Test the Frontend Payment Submission Flow:** The entire frontend user flow for submitting a payment is untested. The existing Playwright test (`payment-form.spec.js`) only checks for the visibility of form fields. A new test is needed to simulate a user filling out the form, submitting it, and verifying the entire process.
-   **[x] Fix Ineffective Pricing Logic Test:** The unit test for the pricing logic (`tests/pricing.test.js`) tests a **local copy of the code**, not the actual implementation from `src/index.js`. This provides a false sense of security. The test must be refactored to import and test the real `calculateStickerPrice` function.
-   **[x] Fix Broken Playwright Tests:** Two Playwright tests have their core verification steps commented out due to "intractable failures". They must be fixed to perform proper automated validation instead of relying on manual screenshot checks.
    -   [x] `playwright_tests/add-text.spec.js`
    -   [x] `playwright_tests/image-upload.spec.js`
-   **[x] Fix failing security tests due to missing test files:** The security tests `tests/security_xss.test.js` and `server/tests/security_mass_assignment.test.js` were failing because they relied on non-existent dummy files. They have been updated to dynamically create and clean up these files.
-   **[x] Fix failing tracker tests:** The test `tests/tracker.test.js` was failing because the `EasyPost` mock was not being applied correctly due to module resolution issues between the root and server `node_modules`. This has been fixed by mocking the specific resolved path.
-   **[x] Fix failing Telegram Bot unit tests:** The tests in `tests/telegram_bot.test.js` are failing with "next(ctx) called with invalid context" due to improper mocking of the `Telegraf` bot instance in the test environment.
-   **[x] Fix regression in `traceContour`:** Fixed an issue where `traceContour` failed to detect full-bleed opaque images (or images matching the detected background color) by implementing a fallback retry mechanism without background color filtering (Fixed regression caused by closure capturing initial background color).

---

### **Medium-Priority: Test Infrastructure & Coverage Expansion**

These items address fundamental problems with the test setup and major gaps in feature coverage.

-   **[x] Unify Test Environment Setup:** The Jest environment is not configured correctly to handle ES module imports from the `/src` directory, forcing bad practices like code duplication in tests. This needs to be fixed to allow for standard `import` statements in all unit tests.
-   **[x] Remove API Mocking in E2E Tests:** The entire Playwright suite runs against a mocked backend. While this is useful for isolating the frontend, it is not a true end-to-end test. A separate E2E test suite or configuration should be created that runs against the **real backend** to validate full-stack integration.
    -   [x] Created `server/test-server.js` to run the real backend with a mocked Square client.
    -   [x] Updated `playwright.real.config.js` to use the test server.
    -   [x] Created `playwright_tests_real/order-flow.spec.js` to test the full order creation flow (upload -> price -> checkout -> order creation) against the real backend.
    -   [x] Fixed issues in `src/index.js` payload mapping and `server/server.js` validation discovered during this testing.
-   **[x] Add Tests for All Authentication Flows:** Backend integration tests are missing for all non-password authentication methods. Test suites need to be created for:
    -   [x] WebAuthn (Passkey) registration and login (`/api/auth/register-verify`, `/api/auth/login-verify`, etc.).
    -   [x] Magic Link generation and verification (`/api/auth/magic-login`, `/api/auth/verify-magic-link`).
    -   [x] Google OAuth flow (`/auth/google`, `/oauth2callback`).
    -   [x] **Add E2E Magic Link Verification Test (Real Backend):** Created `playwright_tests_real/magic-link.spec.js` and updated server to support token retrieval in test mode.
-   **[x] Fix Server Test Configuration:** Updated `run-tests.sh` to execute server-specific tests (`npm run test:server`) and fixed `jest.config.js` to isolate root unit tests. Also fixed regression in `server/tests/redis_rate_limit.test.js`.
-   **[x] Fix Test Suite Regressions:** Fixed failing tests in `tests/tracker.test.js` (logging mock), `tests/orders.test.js` (error status code), and `tests/google-oauth.test.js` (CSRF flow). Restored full test suite pass state.
-   **[x] Add Tests for Frontend Image Manipulation:** None of the frontend image editing features are tested. Unit or integration tests are needed for:
    -   [x] Adding text to the canvas.
    -   [x] Image rotation, resizing, and filters (grayscale, sepia).
    -   [x] The "Smart Cutline" generation feature (`traceContour`, `simplifyPolygon`).

---

### **Low-Priority: Cleanup & Minor Gaps**

These are smaller tasks for improving test quality and covering minor edge cases.

-   **[x] Remove Placeholder Test:** The file `tests/simple.test.js` contains a useless test (`expect(true).toBe(true)`) and should be deleted.
-   **[x] Expand Incomplete Server Tests:** The main backend integration test (`tests/server.test.js`) only covers the `/api/ping` endpoint. It should be expanded to cover all other non-auth, non-order-related endpoints.
-   **[x] Add Test for CLI `remove-key` Command:** The command-line interface test (`tests/cli_test.sh`) is missing coverage for the `remove-key` command.
-   **[x] Consolidate Redundant Tests:** The `/api/ping` endpoint is tested in two different files. The duplicate test should be removed.
-   **[x] Fix Server Pricing Tests:** Fix the regression in `tests/server-pricing.test.js` where perimeters were checked against array length instead of calculated value.
-   **[x] Remove Unused Dependency `lucas`:** This package appears to be a typo for `lusca` and is unused.
-   **[x] Fix E2E test warnings:** Fixed "Test image not found" warning in `verify_features.spec.js` and "Unhandled API route" warning in `test-setup.js`. Fixed race condition in `verify_features.spec.js` causing failures.
-   **[x] Fix regression:** Fixed unhandled API route /api/inventory in E2E tests.

---
<br>

# Project To-Do List

This document tracks the features and bug fixes that need to be implemented for the print shop application.

## Print Shop Page

- [x] **Filter by Category:** Implement a filter button to allow viewing different categories of print jobs (e.g., New, In Progress, Shipped, Canceled, Delivered, Completed).
- [x] **Add "Delivered" Category:** Add a new "Delivered" status category for orders.
- [x] **Add "Completed" Category:** Add a new "Completed" status category for orders.
- [x] **Printing Marks:** Include functionality to add printing marks for borders on the print sheet.
- [x] **Media Margins:** Add the ability to define keepout areas or margins on the interior and edges of media rolls.
- [x] **Nesting Improvements:** Improve nesting of items on the print sheet, aided by the bounding box implementation.

## Telegram Bot

- [x] **Delete "Order Stalled" Message:** When an order's status changes from "Stalled", the corresponding notification message in the Telegram chat should be deleted. (Fixed missing implementation in server.js)
- [x] **Delete Order Images on Completion:** When an order is marked as "Completed", the associated images posted in the Telegram chat should be deleted.
    - [x] Also delete Cut Line Documents (SVG/PDF).
- [x] **Expanded Menu Functions:** Add more menu functions to the bot to list orders by specific statuses:
    - [x] List New Orders
    - [x] List In-Process Orders
    - [x] List Shipped Orders
    - [x] List Canceled Orders
    - [x] List Delivered Orders
    - [x] List Completed Orders

## SVG, Pricing, and Customer Workflow

- [x] **SVG Cut Path Generation:**
    - [x] Fix the existing SVG edge cut outline tool.
    - [x] Automatically generate a cut path when a customer uploads an image.
- [x] **Square Inch Pricing:**
    - [x] Move the pricing model to be based on the square inch bounding box of the sticker.
    - [x] Adjust the price based on the complexity or length of the generated/provided cut path.
    - [x] **Improve Server-Side Perimeter Calculation:** Replace the simplified regex-based perimeter calculation in `server/pricing.js` with `svg-path-properties` to accurately handle curves and complex paths.
    - [x] **Support Basic SVG Shapes:** Extend server-side perimeter calculation to support `rect`, `circle`, `ellipse`, `polygon`, and `polyline` elements.
- [x] **Visual Bounding Box:**
    - [x] Allow the customer to see the calculated bounding box when they scale their uploaded image.
    - [x] **Bug:** Bounding box is not visible.
- [x] **Size Indicators:**
    - [x] **Bug:** Size display does not update on resize.
    - [x] Display the sticker's dimensions directly on the canvas preview.
    - [x] Show the current width and height in a dedicated text area.
- [x] **Standard Size Buttons:**
    - [x] Add buttons for one-click resizing to 1", 2", and 3" sizes.
- [x] **Unit Selection:**
    - [x] Add a control to switch between inches and millimeters for display.

## Print Shop Page
- [x] **PDF Export:** Add a button to export the nested print sheet as a PDF.

## Authentication

- [x] **YubiKey FIDO Authentication:**
    - [x] Create a test script to verify that the FIDO/WebAuthn libraries are working correctly.
    - [x] Fix the YubiKey FIDO authentication flow.
    - [x] Fully integrate FIDO as a primary authentication method.

## Order Fulfillment

- [x] **Shipment Tracking:**
    - [x] Integrate with UPS or USPS APIs to track the delivery status of shipped orders.
    - [x] Use the tracking information to automatically move orders to the "Delivered" status.

## Testing and Deployment

- [x] **End-to-End (E2E) Testing:**
    - [x] Install and configure Playwright for E2E testing.
    - [x] Create an initial test case to verify the homepage loads correctly.
    - [x] Add a `test:e2e` script to `package.json` to run the E2E tests.
- [x] **Staging Environment:**
    - [x] Set up a staging environment that mirrors production.
    - [x] Create a process for sanitizing and loading production data into the staging environment.
- [x] **Automated Backups:**
    - [x] Implement a script to back up the database and user uploads to cloud storage.
    - [x] Document the backup and restore process.

---
<br>

# Security Backlog

This section tracks security vulnerabilities and hardening tasks that need to be addressed.

## High-Priority

-   **[x] Fix critical security vulnerabilities in dependencies:** Address high-severity/critical vulnerabilities in `jspdf` (Path Traversal/RCE), `validator`, `body-parser`, `qs`, `tar`, and `jws`.
-   **[x] Implement a Secret Management Solution:** Replace the use of `.env` files in production and staging with a secure secret management service (e.g., Doppler, HashiCorp Vault, or a cloud provider's service) to protect all credentials and API keys.
-   **[x] Enforce HTTPS:** Update the Nginx configuration to redirect all HTTP traffic to HTTPS and implement a strong TLS configuration. Automate SSL certificate renewal using Certbot or a similar tool.
-   **[x] Validate Order Amount on Server:** Ensure the order amount sent by the client matches the calculated price based on product dimensions and configuration to prevent price tampering.
-   **[x] Fix Vulnerable Dependencies:** The `node-telegram-bot-api` package has known vulnerabilities due to its reliance on the deprecated `request` package. A full migration to a modern alternative is required. See the [detailed migration plan](./archive/telegram_bot_migration.md) for a step-by-step guide.
-   **[x] Implement Role-Based Access Control (RBAC):** Add a `role` field to the user model and protect administrative endpoints (e.g., `/api/orders`) to ensure only authorized users can access them.
-   **[x] Fix failing security tests caused by WAF blocking:** Updated security tests (`tests/security_input_validation.test.js`, `tests/security_xss.test.js`, etc.) to mock the WAF middleware, ensuring that application-level validation and sanitization logic is correctly verified.

## Medium-Priority

-   **[x] Remove Fallback Session Secret:** Remove the hardcoded fallback session secret from `server/server.js` to ensure the application fails securely if the secret is not provided.
-   **[x] Harden Docker Image:** Modify `server/Dockerfile` to create and use a non-root user to run the application, reducing the risk of container-based attacks.
-   **[x] Improve Input Validation:** Perform a full audit of all API endpoints and apply consistent, strict input validation to all user-supplied data (including URL parameters, query strings, and request bodies).
    -   [x] Add strict validation to /api/auth/verify-magic-link
-   **[x] Remove duplicated price validation logic:** Removed redundant code block in `server/server.js` that performed price validation twice.

## Low-Priority

-   **[x] Improve Example Secrets:** Update `server/env.example` to remove weak example secrets and replace them with clear instructions for generating strong, random values.
-   **[x] Use Environment Variables for Test Passwords:** Refactor tests to pull sensitive data like passwords from environment variables instead of hardcoding them, especially for CI/CD environments.

---
<br>

# Mass Deployment & Scaling

**Readiness Score for Mass Scale (>1000 concurrent users): 5/10**

The current architecture is suitable for an initial MVP or beta release (< 50 concurrent users) but requires significant infrastructure upgrades to handle thousands of users reliably.

## Critical Infrastructure Upgrades (Required for Scale)

- [x] **Migrate Database:** Migrate from `lowdb` (JSON file) to a robust relational database (PostgreSQL) or document store (MongoDB). (Implemented Database Adapter pattern with `LowDbAdapter` and `MongoDbAdapter`).
- [x] **Stateless File Storage:** Move user uploads from the local filesystem (`server/uploads`) to an S3-compatible object storage service (AWS S3, DigitalOcean Spaces). (Implemented `S3StorageProvider` using `@aws-sdk/client-s3`).
- [x] **Distributed Session Store:** Replace the default in-memory/file session store with Redis. This allows user sessions to persist across server restarts and enables load balancing.
- [x] **Horizontal Scaling:** Deploy the application across multiple server instances (containers) behind a Load Balancer (Nginx or DigitalOcean LB) to handle increased traffic.
- [x] **Job Queue System:** Implement a background job queue (e.g., BullMQ with Redis) for resource-intensive tasks like image processing, email sending, and order fulfillment to prevent blocking the main event loop.

## Operational Excellence

- [x] **Centralized Logging:** Replace `console.log` and file logging with a structured logging service (e.g., Datadog, LogDNA, or ELK Stack) for real-time monitoring and alerting.
- [x] **Error Monitoring:** Integrate an error tracking service (e.g., Sentry, Honeybadger) to capture and analyze runtime exceptions instead of relying on email notifications.
- [x] **Performance Monitoring:** Set up Application Performance Monitoring (APM) to track API latency, database query performance, and resource usage. (Enhanced: Implemented local metrics collection for API, DB, and System resources, exposed via /api/metrics)
-   **[x] Automated Backups:** Configure automated, scheduled backups for the database and object storage with a clearly defined retention policy and tested restoration procedure. (Updated `scripts/backup.sh` with `--retention-days` flag and documented in `backups.md`).

## Security & Compliance

- [x] **Distributed Rate Limiting:** Move rate limiting state to Redis to enforce limits across all server instances.
- [x] **Web Application Firewall (WAF):** Deploy a WAF (e.g., Cloudflare) to protect against DDoS attacks, SQL injection, and other common web threats. (Implemented software-based WAF middleware)
- [x] **Data Compliance:** Ensure all data storage and processing practices comply with relevant regulations (GDPR, CCPA) as the user base grows.
    - [x] **Cookie Consent Banner:** Implemented a cookie consent banner on the landing page and orders page.
    - [x] **Data Export:** Added functionality for users to export their account data and order history.
    - [x] **Account Deletion:** Added functionality for users to permanently delete their account and anonymize their order history.
