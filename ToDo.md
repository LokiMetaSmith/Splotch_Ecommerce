# Testing To-Do List

This section outlines critical issues and gaps in the project's automated testing suite. The items are prioritized based on their impact on application stability and correctness.

---

### **High-Priority: Critical Failures & Gaps**

These issues represent the most severe risks to the application's functionality and require immediate attention.

-   **[ ] Fix Test Execution Script:** The main test script (`run-tests.sh`) only executes Playwright E2E tests and **completely ignores all Jest unit and integration tests**. This script must be updated to run the entire test suite (e.g., by running `npm run test:unit && npm run test:e2e`).
-   **[ ] Test the Payment & Order API Endpoints:** The backend API endpoints for creating orders and processing payments (`/api/create-order`) and managing orders (`/api/orders`, `/api/orders/:orderId`, etc.) have **zero test coverage**. These are the most critical, revenue-generating parts of the application and must have robust integration tests.
-   **[ ] Test the Frontend Payment Submission Flow:** The entire frontend user flow for submitting a payment is untested. The existing Playwright test (`payment-form.spec.js`) only checks for the visibility of form fields. A new test is needed to simulate a user filling out the form, submitting it, and verifying the entire process.
-   **[ ] Fix Ineffective Pricing Logic Test:** The unit test for the pricing logic (`tests/pricing.test.js`) tests a **local copy of the code**, not the actual implementation from `src/index.js`. This provides a false sense of security. The test must be refactored to import and test the real `calculateStickerPrice` function.
-   **[ ] Fix Broken Playwright Tests:** Two Playwright tests have their core verification steps commented out due to "intractable failures". They must be fixed to perform proper automated validation instead of relying on manual screenshot checks.
    -   `playwright_tests/add-text.spec.js`
    -   `playwright_tests/image-upload.spec.js`

---

### **Medium-Priority: Test Infrastructure & Coverage Expansion**

These items address fundamental problems with the test setup and major gaps in feature coverage.

-   **[ ] Unify Test Environment Setup:** The Jest environment is not configured correctly to handle ES module imports from the `/src` directory, forcing bad practices like code duplication in tests. This needs to be fixed to allow for standard `import` statements in all unit tests.
-   **[ ] Remove API Mocking in E2E Tests:** The entire Playwright suite runs against a mocked backend. While this is useful for isolating the frontend, it is not a true end-to-end test. A separate E2E test suite or configuration should be created that runs against the **real backend** to validate full-stack integration.
-   **[ ] Add Tests for All Authentication Flows:** Backend integration tests are missing for all non-password authentication methods. Test suites need to be created for:
    -   WebAuthn (Passkey) registration and login (`/api/auth/register-verify`, `/api/auth/login-verify`, etc.).
    -   Magic Link generation and verification (`/api/auth/magic-login`, `/api/auth/verify-magic-link`).
    -   Google OAuth flow (`/auth/google`, `/oauth2callback`).
-   **[ ] Add Tests for Frontend Image Manipulation:** None of the frontend image editing features are tested. Unit or integration tests are needed for:
    -   Adding text to the canvas.
    -   Image rotation, resizing, and filters (grayscale, sepia).
    -   The "Smart Cutline" generation feature (`traceContour`, `simplifyPolygon`).

---

### **Low-Priority: Cleanup & Minor Gaps**

These are smaller tasks for improving test quality and covering minor edge cases.

-   **[ ] Remove Placeholder Test:** The file `tests/simple.test.js` contains a useless test (`expect(true).toBe(true)`) and should be deleted.
-   **[ ] Expand Incomplete Server Tests:** The main backend integration test (`tests/server.test.js`) only covers the `/api/ping` endpoint. It should be expanded to cover all other non-auth, non-order-related endpoints.
-   **[ ] Add Test for CLI `remove-key` Command:** The command-line interface test (`tests/cli_test.sh`) is missing coverage for the `remove-key` command.
-   **[ ] Consolidate Redundant Tests:** The `/api/ping` endpoint is tested in two different files. The duplicate test should be removed.

---
<br>

# Project To-Do List

This document tracks the features and bug fixes that need to be implemented for the print shop application.

## Print Shop Page

- [x] **Filter by Category:** Implement a filter button to allow viewing different categories of print jobs (e.g., New, In Progress, Shipped, Canceled, Delivered, Completed).
- [x] **Add "Delivered" Category:** Add a new "Delivered" status category for orders.
- [x] **Add "Completed" Category:** Add a new "Completed" status category for orders.
- [ ] **Printing Marks:** Include functionality to add printing marks for borders on the print sheet.
- [ ] **Media Margins:** Add the ability to define keepout areas or margins on the interior and edges of media rolls.
- [ ] **Nesting Improvements:** Improve nesting of items on the print sheet, aided by the bounding box implementation.

## Telegram Bot

- [x] **Delete "Order Stalled" Message:** When an order's status changes from "Stalled", the corresponding notification message in the Telegram chat should be deleted.
- [x] **Delete Order Images on Completion:** When an order is marked as "Completed", the associated images posted in the Telegram chat should be deleted.
- [x] **Expanded Menu Functions:** Add more menu functions to the bot to list orders by specific statuses:
    - [x] List New Orders
    - [x] List In-Process Orders
    - [x] List Shipped Orders
    - [x] List Canceled Orders
    - [ ] List Delivered Orders

## SVG, Pricing, and Customer Workflow

- [x] **SVG Cut Path Generation:**
    - [x] Fix the existing SVG edge cut outline tool.
    - [x] Automatically generate a cut path when a customer uploads an image.
- [x] **Square Inch Pricing:**
    - [x] Move the pricing model to be based on the square inch bounding box of the sticker.
    - [x] Adjust the price based on the complexity or length of the generated/provided cut path.
- [ ] **Visual Bounding Box:**
    - [x] Allow the customer to see the calculated bounding box when they are scaling their uploaded image.
    - [ ] **Bug:** Bounding box is not visible.
- [ ] **Size Indicators:**
    - [ ] **Bug:** Size display does not update on resize.
    - [ ] Display the sticker's dimensions directly on the canvas preview.
    - [ ] Show the current width and height in a dedicated text area.
- [ ] **Standard Size Buttons:**
    - [ ] Add buttons for one-click resizing to 1", 2", and 3" sizes.
- [ ] **Unit Selection:**
    - [ ] Add a control to switch between inches and millimeters for display.

## Print Shop Page
- [ ] **PDF Export:** Add a button to export the nested print sheet as a PDF.

## Authentication

- [x] **YubiKey FIDO Authentication:**
    - [x] Create a test script to verify that the FIDO/WebAuthn libraries are working correctly.
    - [x] Fix the YubiKey FIDO authentication flow.
    - [x] Fully integrate FIDO as a primary authentication method.

## Order Fulfillment

- [ ] **Shipment Tracking:**
    - [ ] Integrate with UPS or USPS APIs to track the delivery status of shipped orders.
    - [ ] Use the tracking information to automatically move orders to the "Delivered" status.

## Testing and Deployment

- [ ] **End-to-End (E2E) Testing:**
    - [ ] Install and configure Playwright for E2E testing.
    - [ ] Create an initial test case to verify the homepage loads correctly.
    - [ ] Add a `test:e2e` script to `package.json` to run the E2E tests.
- [ ] **Staging Environment:**
    - [ ] Set up a staging environment that mirrors production.
    - [ ] Create a process for sanitizing and loading production data into the staging environment.
