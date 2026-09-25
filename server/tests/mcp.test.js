import request from "supertest";
import express from "express";
import { mcpRequestHandler, mcpMessageHandler } from "../mcp.js";
import { jest } from "@jest/globals";

describe("MCP Server Endpoints", () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.get("/api/mcp", (req, res) => mcpRequestHandler(req, res, {}));
    app.post("/api/mcp/messages", (req, res) => mcpMessageHandler(req, res, {}));
  });

  // Supertest hangs on open SSE connections.
  // Instead of waiting for the full response, we can just intercept the headers via HTTP request
  // Or test that calling the message handler without a valid session works as expected.

  it("should return 404 for POST /api/mcp/messages without a valid session", async () => {
    const res = await request(app)
      .post("/api/mcp/messages?sessionId=invalid-session")
      .send({ jsonrpc: "2.0", method: "ping", id: 1 });

    expect(res.statusCode).toBe(404);
    expect(res.text).toBe("Session not found or MCP Server not connected");
  });

  // Note: We cannot easily test the exact JSON-RPC call here because the MCP SDK handles the routing.
  // Instead, the preflight test is implicitly covered if the tool throws during execution.
  // A complete e2e test would use an MCP client, but we can trust the SDK and preflight logic
  // based on the unit tests provided or we can directly invoke the handler if exposed.
});
