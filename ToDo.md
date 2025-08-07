# Project To-Do List

This document tracks the features and bug fixes that need to be implemented for the print shop application.

## Print Shop Page

- [ ] **Filter by Category:** Implement a filter button to allow viewing different categories of print jobs (e.g., New, In Progress, Shipped, Canceled, Delivered, Completed).
- [ ] **Add "Delivered" Category:** Add a new "Delivered" status category for orders.
- [ ] **Add "Completed" Category:** Add a new "Completed" status category for orders.
- [ ] **Printing Marks:** Include functionality to add printing marks for borders on the print sheet.
- [ ] **Media Margins:** Add the ability to define keepout areas or margins on the interior and edges of media rolls.
- [ ] **Nesting Improvements:** Improve nesting of items on the print sheet, aided by the bounding box implementation.

## Telegram Bot

- [ ] **Delete "Order Stalled" Message:** When an order's status changes from "Stalled", the corresponding notification message in the Telegram chat should be deleted.
- [ ] **Delete Order Images on Completion:** When an order is marked as "Completed", the associated images posted in the Telegram chat should be deleted.
- [ ] **Expanded Menu Functions:** Add more menu functions to the bot to list orders by specific statuses:
    - [ ] List New Orders
    - [ ] List In-Process Orders
    - [ ] List Shipped Orders
    - [ ] List Canceled Orders
    - [ ] List Delivered Orders

## SVG, Pricing, and Customer Workflow

- [ ] **SVG Cut Path Generation:**
    - [ ] Fix the existing SVG edge cut outline tool.
    - [ ] Automatically generate a cut path when a customer uploads an image.
- [ ] **Square Inch Pricing:**
    - [ ] Move the pricing model to be based on the square inch bounding box of the sticker.
    - [ ] Adjust the price based on the complexity or length of the generated/provided cut path.
- [ ] **Visual Bounding Box:**
    - [ ] Allow the customer to see the calculated bounding box when they are scaling their uploaded image.

## Authentication

- [ ] **YubiKey FIDO Authentication:**
    - [ ] Create a test script to verify that the FIDO/WebAuthn libraries are working correctly.
    - [ ] Fix the YubiKey FIDO authentication flow.
    - [ ] Fully integrate FIDO as a primary authentication method.

## Order Fulfillment

- [ ] **Shipment Tracking:**
    - [ ] Integrate with UPS or USPS APIs to track the delivery status of shipped orders.
    - [ ] Use the tracking information to automatically move orders to the "Delivered" status.
