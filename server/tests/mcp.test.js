import request from "supertest";
import express from "express";
import { mcpRequestHandler, mcpMessageHandler, mcpStreamableHandler, createMcpServer } from "../mcp.js";
import { jest } from "@jest/globals";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

describe("MCP Server Endpoints and Tools", () => {
  let app;
  let mockDb;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    mockDb = {
      createQuote: jest.fn().mockResolvedValue({})
    };

    app.get("/api/mcp", (req, res) => mcpRequestHandler(req, res, mockDb));
    app.post("/api/mcp", (req, res) => mcpStreamableHandler(req, res, mockDb));
    app.post("/api/mcp/messages", (req, res) => mcpMessageHandler(req, res, mockDb));
  });

  it("should handle Streamable HTTP initialize request at POST /api/mcp", async () => {
    const res = await request(app)
      .post("/api/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "claude-client", version: "1.0.0" }
        }
      });

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('"name":"splotch-ecommerce-mcp"');
  });

  it("should return 404 for POST /api/mcp/messages without a valid session", async () => {
    const res = await request(app)
      .post("/api/mcp/messages?sessionId=invalid-session")
      .send({ jsonrpc: "2.0", method: "ping", id: 1 });

    expect(res.statusCode).toBe(404);
    expect(res.text).toBe("Session not found or MCP Server not connected");
  });

  it("should establish SSE connection at /api/mcp", async () => {
    const req = request(app).get("/api/mcp");
    req.buffer(false);

    return new Promise((resolve, reject) => {
      req.end((err, res) => {
        if (err && !res) return reject(err);
      });
      req.on('response', (res) => {
        expect(res.headers['content-type']).toBe('text/event-stream');
        resolve();
      });
    });
  });

  it("should return AP2 Challenge compliant output for create_agent_checkout tool", async () => {
    const mcpServer = createMcpServer(mockDb);
    const requestArgs = {
      method: "tools/call",
      params: {
        name: "create_agent_checkout",
        arguments: {
          quoteId: "quote123",
          amount: "15.00",
          designUrl: "https://example.com/sticker.png",
          shippingAddress: {
            name: "John",
            street: "123 St",
            city: "City",
            state: "ST",
            zip: "12345"
          }
        }
      }
    };

    // We mock fetch to avoid network calls inside the tool
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      headers: new Headers({ "content-length": "100" }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100))
    }));

    // The SDK registers a string 'tools/call'
    const handler = mcpServer._requestHandlers.get('tools/call');
    const result = await handler(requestArgs, {});

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");

    const parsedContent = JSON.parse(result.content[0].text);

    expect(parsedContent.paymentStatus).toBe("REQUIRES_PAYMENT");
    expect(parsedContent.ap2Challenge).toBeDefined();
    expect(parsedContent.ap2Challenge.paymentEndpoint).toBe("https://splotch.page/api/v1/payments/ap2");
    expect(parsedContent.ap2Challenge.requiredAmount).toBe("15.00");
    expect(parsedContent.ap2Challenge.supportedMethods).toContain("x402");
  });

  it("should handle get_order_status tool correctly", async () => {
    mockDb.getOrder = jest.fn().mockResolvedValue({
      orderId: "ord_mcp_123",
      status: "PRINTING",
      receivedAt: "2026-09-28T20:00:00.000Z",
      amount: 15.00
    });

    const mcpServer = createMcpServer(mockDb);
    const handler = mcpServer._requestHandlers.get('tools/call');
    const result = await handler({
      method: "tools/call",
      params: {
        name: "get_order_status",
        arguments: {
          orderId: "ord_mcp_123"
        }
      }
    }, {});

    const parsedContent = JSON.parse(result.content[0].text);
    expect(parsedContent.orderId).toBe("ord_mcp_123");
    expect(parsedContent.status).toBe("PRINTING");
    expect(parsedContent.trackingUrl).toContain("ord_mcp_123");
  });

  it("should handle splotch_get_sticker_quote and splotch_execute_ap2_payment tools", async () => {
    mockDb.createQuote = jest.fn().mockResolvedValue({});
    mockDb.createOrder = jest.fn().mockResolvedValue({});

    const mcpServer = createMcpServer(mockDb);
    const handler = mcpServer._requestHandlers.get('tools/call');

    // 1. splotch_get_sticker_quote with items array
    const quoteResult = await handler({
      method: "tools/call",
      params: {
        name: "splotch_get_sticker_quote",
        arguments: {
          items: [
            {
              product_type: "custom_sticker",
              dimensions: { width_in: 3.0, height_in: 3.0, unit: "inch" },
              quantity: 50,
              material: "standard_pp"
            }
          ]
        }
      }
    }, {});

    const quoteParsed = JSON.parse(quoteResult.content[0].text);
    expect(quoteParsed.quote_id).toBeDefined();
    expect(quoteParsed.pricing).toBeDefined();

    // 2. splotch_execute_ap2_payment with mandate and settlement
    const payResult = await handler({
      method: "tools/call",
      params: {
        name: "splotch_execute_ap2_payment",
        arguments: {
          quote_id: quoteParsed.quote_id,
          ap2_mandate_jws: "eyJhbGciOiJFZERTQSI...",
          settlement: {
            rail: "x402",
            asset: "USDC",
            network: "base",
            tx_hash: "0x123abc",
            amount: quoteParsed.total_usd,
            payer_wallet: "0x49B3c11E866299bBfA689D8B4E15682C562f7D35"
          },
          shipping_destination: {
            recipient_name: "Agent Lab",
            street_address: "123 Main St",
            city: "Oklahoma City",
            state: "OK",
            postal_code: "73159",
            country: "US"
          }
        }
      }
    }, {});

    const payParsed = JSON.parse(payResult.content[0].text);
    expect(payParsed.order_id).toBeDefined();
    expect(payParsed.status).toBe("queued_for_print");
    expect(payParsed.settlement_verification.tx_status).toBe("confirmed");
  });
});
