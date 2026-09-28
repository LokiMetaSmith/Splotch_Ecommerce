import request from "supertest";
import express from "express";
import { mcpRequestHandler, mcpMessageHandler, createMcpServer } from "../mcp.js";
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
    app.post("/api/mcp/messages", (req, res) => mcpMessageHandler(req, res, mockDb));
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
    expect(parsedContent.ap2Challenge.paymentEndpoint).toBe("https://api.splotch.shop/api/v1/payments/ap2");
    expect(parsedContent.ap2Challenge.requiredAmount).toBe("15.00");
    expect(parsedContent.ap2Challenge.supportedMethods).toContain("x402");
  });
});
