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
