import request from "supertest";
import express from "express";
import { mcpRequestHandler, mcpMessageHandler, agentQuotes } from "../mcp.js";

describe("MCP Server Endpoints", () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.get("/api/mcp", mcpRequestHandler);
    app.post("/api/mcp/messages", mcpMessageHandler);
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
});
