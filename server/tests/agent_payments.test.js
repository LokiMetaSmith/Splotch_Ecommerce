import request from "supertest";
import express from "express";
import createAgentPaymentsRouter from "../routes/agent-payments.js";
import { jest } from "@jest/globals";
import * as jose from "jose";

describe("Agent Payments API (/v1/payments/ap2)", () => {
  let app;
  let mockDb;
  let inMemoryQuotes;
  let keypair;
  let badKeypair;
  let jwk;

  beforeAll(async () => {
    keypair = await jose.generateKeyPair('RS256');
    badKeypair = await jose.generateKeyPair('RS256');
    jwk = await jose.exportJWK(keypair.publicKey);
  });

  beforeEach(() => {
    inMemoryQuotes = new Map();

    mockDb = {
      createOrder: jest.fn().mockResolvedValue({}),
      getQuote: jest.fn(async (id) => inMemoryQuotes.get(id)),
      updateQuote: jest.fn(async (quote) => {
        inMemoryQuotes.set(quote.quoteId, quote);
        return quote;
      }),
      getAllOrders: jest.fn().mockResolvedValue([])
    };

    app = express();
    app.use(express.json());
    app.use("/api", createAgentPaymentsRouter(mockDb));
  });

  async function generateMandate(payload, signKey = keypair.privateKey) {
    return await new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', jwk })
      .setIssuedAt()
      .setExpirationTime('2h')
      .setAudience('splotch-creative-settlement')
      .sign(signKey);
  }

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
      .set("x-ap2-mandate", "invalid-jwt")
      .send({});

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain("Cryptographic validation failed");
  });

  it("should return 403 if cryptographic verification fails (tampered/invalid signature)", async () => {
    // Mandate signed with badKeypair but claiming to be the good jwk
    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay123", amount: "15.00" })).toString("base64");
    const mandate = await generateMandate({ intentId: "intent123", quoteId: "quote_1" }, badKeypair.privateKey);
    const res = await request(app)
      .post("/api/v1/payments/ap2")
      .set("authorization-x402", paymentProof)
      .set("x-ap2-mandate", mandate)
      .send({});

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain("Cryptographic validation failed");
  });

  it("should return 403 if mandate is expired (via standard JWT exp claim)", async () => {
    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay123", amount: "15.00" })).toString("base64");

    // Create an explicitly expired token
    const mandate = await new jose.SignJWT({ intentId: "intent123", quoteId: "quote_1" })
      .setProtectedHeader({ alg: 'RS256', jwk })
      .setIssuedAt()
      .setExpirationTime('-1h')
      .setAudience('splotch-creative-settlement')
      .sign(keypair.privateKey);

    const res = await request(app)
      .post("/api/v1/payments/ap2")
      .set("authorization-x402", paymentProof)
      .set("x-ap2-mandate", mandate)
      .send({});

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain("Cryptographic validation failed");
  });

  it("should return 404 if quote is not found", async () => {
    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay123", amount: "15.00" })).toString("base64");
    const mandate = await generateMandate({ intentId: "intent123", quoteId: "nonexistent_quote" });

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
    inMemoryQuotes.set(expiredQuoteId, {
      quoteId: expiredQuoteId,
      total: 15.00,
      status: "PENDING",
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });

    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay123", amount: "15.00" })).toString("base64");
    const mandate = await generateMandate({ intentId: "intent123", quoteId: expiredQuoteId });

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
    inMemoryQuotes.set(validQuoteId, {
      quoteId: validQuoteId,
      total: 20.00,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000).toISOString()
    });

    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay123", amount: "15.00" })).toString("base64");
    const mandate = await generateMandate({ intentId: "intent123", quoteId: validQuoteId });

    const res = await request(app)
      .post("/api/v1/payments/ap2")
      .set("authorization-x402", paymentProof)
      .set("x-ap2-mandate", mandate)
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Payment amount does not match stored quote");
  });

  it("should return 400 on duplicate payment (replay protection)", async () => {
    const validQuoteId = "quote_valid_replay";
    inMemoryQuotes.set(validQuoteId, {
      quoteId: validQuoteId,
      total: 15.00,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000).toISOString()
    });

    mockDb.getAllOrders = jest.fn().mockResolvedValue([{ paymentId: "pay123" }]);

    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay123", amount: "15.00" })).toString("base64");
    const mandate = await generateMandate({ intentId: "intent123", quoteId: validQuoteId });

    const res = await request(app)
      .post("/api/v1/payments/ap2")
      .set("authorization-x402", paymentProof)
      .set("x-ap2-mandate", mandate)
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Payment proof has already been processed");
  });

  it("should return 403 if agent mandate spending limit is exceeded", async () => {
    const validQuoteId = "quote_valid_but_spending_exceeded";
    inMemoryQuotes.set(validQuoteId, {
      quoteId: validQuoteId,
      total: 15.00,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000).toISOString()
    });

    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay123", amount: "15.00" })).toString("base64");
    const mandate = await generateMandate({
      intentId: "intent123",
      quoteId: validQuoteId,
      maxSpendCents: 1000 // Only allowed $10, quote is $15
    });

    const res = await request(app)
      .post("/api/v1/payments/ap2")
      .set("authorization-x402", paymentProof)
      .set("x-ap2-mandate", mandate)
      .send({});

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("Agent mandate spending limit exceeded");
  });

  it("should succeed with 201 if agent mandate rules are satisfied", async () => {
    const validQuoteId = "quote_valid_with_rules";
    inMemoryQuotes.set(validQuoteId, {
      quoteId: validQuoteId,
      total: 15.00,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000).toISOString()
    });

    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay123", amount: "15.00" })).toString("base64");
    const mandate = await generateMandate({
      intentId: "intent123",
      quoteId: validQuoteId,
      maxSpendCents: 2000 // $20 allowed limit
    });

    const res = await request(app)
      .post("/api/v1/payments/ap2")
      .set("authorization-x402", paymentProof)
      .set("x-ap2-mandate", mandate)
      .send({});

    expect(res.statusCode).toBe(201);
    expect(res.body.orderId).toBeDefined();
    expect(res.body.status).toBe("CONFIRMED");
  });
});
