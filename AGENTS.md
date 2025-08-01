# Agent Instructions

This document provides guidance for AI agents working on this codebase.

## Application Architecture

This application follows a standard client-server architecture. It consists of three main parts:

1.  **Customer-Facing Client (`index.html`, `src/index.js`)**: This is the main web page where customers can edit a sticker design and submit an order. All order and payment data from this page is sent directly to the Node.js server.

2.  **Node.js Server (`server/server.js`)**: This is the central backend for the application. It is responsible for:
    *   Handling API requests from both the customer client and the print shop dashboard.
    *   Processing payments with the Square API.
    *   Storing order and user data in a `lowdb` JSON database (`db.json`).
    *   Managing user authentication via JWTs.

3.  **Print Shop Dashboard (`printshop.html`, `printshop.js`)**: This is an internal-facing dashboard for the print shop to view and manage incoming orders. This page **fetches all its data from the Node.js server** via API calls.

## Deprecation of PeerJS

**IMPORTANT:** The use of the **PeerJS library is deprecated and has been removed.**

Previous versions of this application used PeerJS to create a direct peer-to-peer connection between the customer client and the print shop dashboard. This was done to send order data directly between the two clients.

This architecture has been abandoned in favor of the more robust and scalable client-server model described above. Please **do not** re-introduce any PeerJS-related functionality. All data should flow through the central Node.js server.
