# Agentic Payments & MCP Integration

This document outlines the architecture and workflow for autonomous machine-to-machine (M2M) checkouts within the Splotch platform. By leveraging the Model Context Protocol (MCP) and emerging M2M payment standards, AI agents (like Claude Desktop, custom bots, etc.) can programmatically request quotes and purchase sticker orders on behalf of users.

## 1. Architectural Overview

The agentic payment stack relies on two core protocols working in concert:

*   **MCP (Model Context Protocol):** Exposes our pricing engine and checkout capabilities as distinct tools over a Server-Sent Events (SSE) connection. This allows AI models to natively understand the Splotch catalog and request quotes without human interaction.
*   **AP2 & x402 Payments:** We utilize an "AND" condition combining Google's **AP2 Protocol** (Agent-to-Payments) for governance and the **x402 standard** (`HTTP 402 Payment Required`) for the actual payment rail.
    *   **x402:** Handles the financial transaction layer (typically via stablecoin or crypto rails).
    *   **AP2 Cart Mandate:** Acts as the governance layer. It is a cryptographically signed credential proving that the human user authorized the agent to execute this specific purchase.

## 2. The Agent Workflow

When an autonomous AI agent wants to order stickers, the interaction follows a strict, multi-step handshake:

### Step 1: Tool Discovery & Quoting (MCP)
1.  The agent connects to the Splotch MCP server at `GET /api/mcp`.
2.  A dedicated session is spawned for the agent.
3.  The agent executes the `calculate_sticker_quote` tool, passing parameters like dimensions, material, cut type, and quantity.
4.  The server calculates the price, stores the quote locally in memory (with a 30-minute expiration), and returns a unique `quoteId` alongside the calculated `total` amount.

### Step 2: Intent Generation (MCP)
1.  The agent decides to proceed with the purchase.
2.  It executes the `create_agent_checkout` tool, providing the `quoteId`, the generated design URL, and the user's shipping address.
3.  The server responds with an `x402Challenge`. This tells the agent exactly where to post the payment (`/api/v1/payments/ap2`) and what the required amount is.

### Step 3: Payment Execution (HTTP API)
1.  The agent submits a `POST` request to `/api/v1/payments/ap2` containing the order payload.
2.  **The 402 Challenge:** If the agent arrives without payment headers, Splotch intercepts the request and responds with an `HTTP 402 Payment Required`, dictating that both an x402 payment proof and an AP2 mandate are required.
3.  **The Purchase:** The agent fulfills the payment on its preferred rails and re-submits the `POST` request, attaching:
    *   `authorization-x402`: Proof of the financial settlement.
    *   `x-ap2-mandate`: The signed governance token proving the user authorized the cart.
4.  The server validates both cryptographic tokens.

### Step 4: Quote Verification & Fulfillment
1.  Before finalizing, Splotch extracts the `quoteId` from the AP2 mandate.
2.  It cross-references this ID against the server-side `agentQuotes` memory map.
3.  **Security Checks:** Splotch ensures the quote exists, has not expired, and most importantly, that the paid `amount` matches the originally quoted price exactly. (This prevents agents from arbitrarily dictating lower prices in their payloads).
4.  If all checks pass, the print-shop job is enqueued via `db.createOrder()`, and a `201 Created` status is returned to the agent with tracking information.

## 3. Security Considerations

*   **No Payload Trust:** The payment endpoint *never* trusts the `amount` field provided in the agent's raw JSON body. It strictly relies on the server-calculated total stored in the quote cache.
*   **Session Isolation:** MCP connections over Express can suffer from cross-talk if not handled carefully. Our implementation maps `SSEServerTransport` instances dynamically to active `sessionIds`, ensuring concurrent agent checkouts remain completely isolated.
*   **Rate Limiting:** All agent endpoints, including the MCP transport and the x402 checkout route, are mounted behind the primary `apiLimiter` to mitigate programmatic spam and DoS attacks.
