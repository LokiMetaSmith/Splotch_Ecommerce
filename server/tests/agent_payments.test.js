import request from "supertest";
import express from "express";
import createAgentPaymentsRouter from "../routes/agent-payments.js";
import { agentQuotes } from "../mcp.js";
import { jest } from "@jest/globals";

describe("Agent Payments API (/v1/payments/ap2)", () => {
  let app;
  let mockDb;

  beforeEach(() => {
    // Reset global quotes map
    agentQuotes.clear();

    mockDb = {
      createOrder: jest.fn().mockResolvedValue({}),
    };

    app = express();
    app.use(express.json());
    app.use("/api", createAgentPaymentsRouter(mockDb));
  });

  it("should return 402 Payment Required if headers are missing", async () => {
    const res = await request(app).post("/api/v1/payments/ap2").send({
      amount: "10.00",
    });

    expect(res.statusCode).toBe(402);
    expect(res.body.error).toBe("Payment Required");
    expect(res.body.protocol).toBe("x402");
  });

  it("should return 403 if cryptographic verification fails (invalid token structure)", async () => {
    const res = await request(app)
      .post("/api/v1/payments/ap2")
      .set("authorization-x402", "invalid-base64")
      .set("x-ap2-mandate", "invalid-base64")
      .send({});

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain("Cryptographic validation failed");
  });

  it("should return 404 if quote is not found", async () => {
    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay123", amount: "15.00" })).toString("base64");
    const mandate = Buffer.from(JSON.stringify({ intentId: "intent123", quoteId: "nonexistent_quote" })).toString("base64");

    const res = await request(app)
      .post("/api/v1/payments/ap2")
      .set("authorization-x402", paymentProof)
      .set("x-ap2-mandate", mandate)
      .send({});

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe("Quote not found or invalid quoteId");
  });

  it("should return 400 if quote is expired", async () => {
    const expiredQuoteId = "quote_expired";
    agentQuotes.set(expiredQuoteId, {
      quoteId: expiredQuoteId,
      total: 15.00,
      expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired
    });

    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay123", amount: "15.00" })).toString("base64");
    const mandate = Buffer.from(JSON.stringify({ intentId: "intent123", quoteId: expiredQuoteId })).toString("base64");

    const res = await request(app)
      .post("/api/v1/payments/ap2")
      .set("authorization-x402", paymentProof)
      .set("x-ap2-mandate", mandate)
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Quote has expired");
  });

  it("should return 400 if provided amount does not match stored quote", async () => {
    const validQuoteId = "quote_amount_mismatch";
    agentQuotes.set(validQuoteId, {
      quoteId: validQuoteId,
      total: 25.00, // Quote is for 25.00
      expiresAt: new Date(Date.now() + 100000).toISOString(),
    });

    // Payment proof says 15.00
    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay123", amount: "15.00" })).toString("base64");
    const mandate = Buffer.from(JSON.stringify({ intentId: "intent123", quoteId: validQuoteId })).toString("base64");

    const res = await request(app)
      .post("/api/v1/payments/ap2")
      .set("authorization-x402", paymentProof)
      .set("x-ap2-mandate", mandate)
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Payment amount does not match stored quote");
  });

  it("should create an order and return 201 on valid payment and quote", async () => {
    const validQuoteId = "quote_valid";
    agentQuotes.set(validQuoteId, {
      quoteId: validQuoteId,
      total: 15.00,
      expiresAt: new Date(Date.now() + 100000).toISOString(),
    });

    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay123", amount: "15.00" })).toString("base64");
    const mandate = Buffer.from(JSON.stringify({ intentId: "intent123", quoteId: validQuoteId })).toString("base64");

    const res = await request(app)
      .post("/api/v1/payments/ap2")
      .set("authorization-x402", paymentProof)
      .set("x-ap2-mandate", mandate)
      .send({
        items: [{ id: "sticker1" }],
        shippingAddress: { city: "New York" }
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe("CONFIRMED");
    expect(res.body.orderId).toMatch(/^ord_/);
    expect(res.body.trackingUrl).toContain(res.body.orderId);

    expect(mockDb.createOrder).toHaveBeenCalledTimes(1);
    const orderArg = mockDb.createOrder.mock.calls[0][0];
    expect(orderArg.amount).toBe(15.00);
    expect(orderArg.buyerType).toBe("agent");
    expect(orderArg.status).toBe("NEW");
  });
});
