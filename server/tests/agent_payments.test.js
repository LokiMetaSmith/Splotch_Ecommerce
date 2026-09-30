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
      getOrder: jest.fn(async (id) => ({ orderId: id, status: "NEW", amount: 15.00, receivedAt: new Date().toISOString() })),
      getQuote: jest.fn(async (id) => inMemoryQuotes.get(id)),
      createQuote: jest.fn(async (quote) => {
        inMemoryQuotes.set(quote.quoteId, quote);
        return quote;
      }),
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
      .send({
        designUrl: "https://example.com/artwork.png",
        shippingAddress: {
          name: "Test Agent",
          email: "agent@test.com",
          street: "123 Main St",
          city: "OKC",
          state: "OK",
          zip: "73101"
        }
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.orderId).toBeDefined();
    expect(res.body.status).toBe("CONFIRMED");
    expect(res.body.trackingUrl).toContain("splotch.page");
  });

  it("should return 200 protocol information on GET /api/v1/payments/ap2", async () => {
    const res = await request(app).get("/api/v1/payments/ap2");
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("active");
    expect(res.body.protocol).toBe("x402");
    expect(res.body.ap2_support).toBe(true);
    expect(res.body.methods_supported).toContain("POST");
    expect(res.body.required_headers).toContain("authorization-x402");
    expect(res.body.required_headers).toContain("x-ap2-mandate");
  });

  it("should create a quote on POST /api/v1/quotes and allow retrieval via GET", async () => {
    const quoteRes = await request(app)
      .post("/api/v1/quotes")
      .send({
        widthInches: 3.0,
        heightInches: 3.0,
        quantity: 50,
        material: "vinyl_matte",
        cutType: "die_cut"
      });

    expect(quoteRes.statusCode).toBe(201);
    expect(quoteRes.body.quoteId).toBeDefined();
    expect(quoteRes.body.total).toBeGreaterThan(0);
    expect(quoteRes.body.ap2_payment_endpoint).toBe("/api/v1/payments/ap2");

    const getRes = await request(app).get(`/api/v1/quotes/${quoteRes.body.quoteId}`);
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body.quoteId).toBe(quoteRes.body.quoteId);
    expect(getRes.body.status).toBe("PENDING");
  });

  it("should return 402 challenge on POST /api/v1/orders when payment headers are missing", async () => {
    const res = await request(app)
      .post("/api/v1/orders")
      .send({
        quoteId: "quote_test_123",
        amount: "15.00"
      });

    expect(res.statusCode).toBe(402);
    expect(res.body.error).toBe("Payment Required");
    expect(res.body.protocol).toBe("x402");
    expect(res.body.quote).toBeDefined();
  });

  it("should confirm order on POST /api/v1/orders when valid payment proof and mandate are supplied", async () => {
    const validQuoteId = "quote_order_direct";
    inMemoryQuotes.set(validQuoteId, {
      quoteId: validQuoteId,
      total: 20.00,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000).toISOString()
    });

    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay_order_direct", amount: "20.00" })).toString("base64");
    const mandate = await generateMandate({
      intentId: "intent_order_direct",
      quoteId: validQuoteId,
      maxSpendCents: 2500
    });

    const res = await request(app)
      .post("/api/v1/orders")
      .set("authorization-x402", paymentProof)
      .set("x-ap2-mandate", mandate)
      .send({
        amount: "20.00",
        quoteId: validQuoteId,
        designUrl: "https://example.com/order-art.png",
        shippingAddress: {
          name: "Order Direct",
          email: "buyer@example.com",
          street: "456 Test Way",
          city: "Tulsa",
          state: "OK",
          zip: "74103"
        }
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe("CONFIRMED");
    expect(res.body.orderId).toBeDefined();
    expect(res.body.trackingUrl).toContain("splotch.page");
  });

  it("should return order details on GET /api/v1/orders/:orderId", async () => {
    const res = await request(app).get("/api/v1/orders/ord_sample_123");
    expect(res.statusCode).toBe(200);
    expect(res.body.orderId).toBe("ord_sample_123");
    expect(res.body.status).toBe("NEW");
    expect(res.body.trackingUrl).toContain("ord_sample_123");
  });

  it("should accept Gemini's exact nested items payload for quotes and payments", async () => {
    // 1. Quoting with Gemini nested payload
    const quoteRes = await request(app)
      .post("/api/v1/quotes")
      .send({
        items: [
          {
            product_type: "custom_sticker",
            dimensions: { width_in: 3.0, height_in: 3.0, unit: "inch" },
            cut_type: "die_cut",
            shape: "custom_contour",
            material: "standard_pp",
            quantity: 100,
            artwork_url: "https://example.com/agent.png"
          }
        ],
        tradeoffs: { flexible_filler_window: true },
        delivery: { method: "ship", postal_code: "73159", country: "US" }
      });

    expect(quoteRes.statusCode).toBe(201);
    expect(quoteRes.body.quote_id).toBeDefined();
    expect(quoteRes.body.status).toBe("valid");
    expect(quoteRes.body.pricing).toBeDefined();
    expect(quoteRes.body.settlement_equivalents).toBeDefined();

    const quoteId = quoteRes.body.quote_id;
    const totalAmount = quoteRes.body.total;

    // 2. AP2 Cart Mandate with Gemini format
    const mandate = await generateMandate({
      cart_binding: {
        quote_id: quoteId,
        exact_amount: totalAmount.toFixed(2)
      },
      agent_rules: {
        max_amount: { amount: (totalAmount + 10).toFixed(2), currency: "USD" }
      }
    });

    // 3. Payment with Gemini payload (settlement in body, X-AP2-Mandate header)
    const payRes = await request(app)
      .post("/api/v1/payments/ap2")
      .set("X-AP2-Mandate", mandate)
      .send({
        quote_id: quoteId,
        settlement: {
          rail: "x402",
          asset: "USDC",
          network: "base",
          tx_hash: "0xb67d983e8fa298108c4e78291f09238e821bca89d1341052981ef407e3cb752a",
          amount: totalAmount.toFixed(2),
          payer_wallet: "0x49B3c11E866299bBfA689D8B4E15682C562f7D35"
        },
        designUrl: "https://example.com/gemini-sticker.png",
        shipping_destination: {
          recipient_name: "Autonomous Agent Lab",
          email: "lab@example.com",
          street_address: "7712 S. Penn Ave",
          city: "Oklahoma City",
          state: "OK",
          postal_code: "73159",
          country: "US"
        }
      });

    expect(payRes.statusCode).toBe(201);
    expect(payRes.body.order_id).toBeDefined();
    expect(payRes.body.mandate_verification.valid).toBe(true);
    expect(payRes.body.settlement_verification.tx_status).toBe("confirmed");
    expect(payRes.body.fulfillment_tracking_url).toContain("orders");
  });

  it("should return 403 if mandate binds a shipping address hash and a tampered address is submitted", async () => {
    const validQuoteId = "quote_shipping_hash_test";
    inMemoryQuotes.set(validQuoteId, {
      quoteId: validQuoteId,
      total: 15.00,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000).toISOString()
    });

    const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay_ship_123", amount: "15.00" })).toString("base64");
    
    // Mandate authorizes shipment to original address hash
    const mandate = await generateMandate({
      intentId: "intent_ship_test",
      quoteId: validQuoteId,
      shipping_address_hash: "expected_hash_for_original_address"
    });

    const res = await request(app)
      .post("/api/v1/payments/ap2")
      .set("authorization-x402", paymentProof)
      .set("x-ap2-mandate", mandate)
      .send({
        shipping_destination: {
          recipient_name: "Attacker",
          street_address: "999 Evil St",
          city: "Oklahoma City",
          state: "OK",
          postal_code: "73159",
          country: "US"
        }
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain("recipient destination differs");
  });

  it("should return 403 in production if a simulated payment proof is submitted", async () => {
    const origEnv = process.env.NODE_ENV;
    const origAllowEphem = process.env.AP2_ALLOW_EPHEMERAL_JWK;
    process.env.NODE_ENV = "production";
    process.env.AP2_ALLOW_EPHEMERAL_JWK = "true";

    try {
      const validQuoteId = "quote_prod_sim_test";
      inMemoryQuotes.set(validQuoteId, {
        quoteId: validQuoteId,
        total: 15.00,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 60000).toISOString()
      });

      const paymentProof = Buffer.from(JSON.stringify({ status: "PAID", paymentId: "pay_sim_prod", amount: "15.00" })).toString("base64");
      const mandate = await generateMandate({ intentId: "intent_prod", quoteId: validQuoteId });

      const res = await request(app)
        .post("/api/v1/payments/ap2")
        .set("authorization-x402", paymentProof)
        .set("x-ap2-mandate", mandate)
        .send({});

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toContain("Simulated payment proofs are forbidden in production");
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origAllowEphem === undefined) {
        delete process.env.AP2_ALLOW_EPHEMERAL_JWK;
      } else {
        process.env.AP2_ALLOW_EPHEMERAL_JWK = origAllowEphem;
      }
    }
  });

  it("should confirm order on POST /api/v1/orders with direct x402 payment proof WITHOUT an AP2 mandate", async () => {
    const validQuoteId = "quo_direct_x402";
    await mockDb.createQuote({
      quoteId: validQuoteId,
      total: 0.35,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000).toISOString()
    });

    const paymentProof = Buffer.from(JSON.stringify({
      status: "PAID",
      paymentId: "tx_direct_test_123",
      amount: "0.35",
      rail: "base_usdc",
      tx_hash: "0x1234567890123456789012345678901234567890123456789012345678901234"
    })).toString("base64");

    const res = await request(app)
      .post("/api/v1/orders")
      .set("authorization-x402", paymentProof)
      .send({
        quoteId: validQuoteId,
        designUrl: "https://example.com/direct-usdc.png",
        shippingAddress: {
          name: "Direct Buyer",
          email: "buyer@direct.com",
          street: "123 Base St",
          city: "Oklahoma City",
          state: "OK",
          zip: "73120"
        }
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe("CONFIRMED");
    expect(res.body.mandate_verification.type).toBe("direct_x402_onchain");
    expect(mockDb.createOrder).toHaveBeenCalled();
  });

  it("should return detailed Base USDC settlement metadata in 402 challenge", async () => {
    const res = await request(app).post("/api/v1/orders").send({});
    expect(res.statusCode).toBe(402);
    expect(res.body.settlement_details).toBeDefined();
    expect(res.body.settlement_details.base_usdc).toBeDefined();
    expect(res.body.settlement_details.base_usdc.chain_id).toBe(8453);
    expect(res.body.settlement_details.base_usdc.token_address).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(res.body.settlement_details.base_usdc.recipient_address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("should reject order with 400 if designUrl is missing", async () => {
    const quoteId = "quo_no_art";
    await mockDb.createQuote({
      quoteId,
      total: 0.35,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000).toISOString()
    });

    const paymentProof = Buffer.from(JSON.stringify({
      status: "PAID",
      paymentId: "tx_no_art_123",
      amount: "0.35"
    })).toString("base64");

    const res = await request(app)
      .post("/api/v1/orders")
      .set("authorization-x402", paymentProof)
      .send({
        quoteId,
        shippingAddress: {
          name: "No Art Buyer",
          email: "buyer@example.com",
          street: "123 Test St",
          city: "OKC",
          state: "OK",
          zip: "73101"
        }
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Missing required order field: 'designUrl'");
  });

  it("should reject order with 400 if shippingAddress.email is missing or invalid", async () => {
    const quoteId = "quo_no_email";
    await mockDb.createQuote({
      quoteId,
      total: 0.35,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000).toISOString()
    });

    const paymentProof = Buffer.from(JSON.stringify({
      status: "PAID",
      paymentId: "tx_no_email_123",
      amount: "0.35"
    })).toString("base64");

    const res = await request(app)
      .post("/api/v1/orders")
      .set("authorization-x402", paymentProof)
      .send({
        quoteId,
        designUrl: "https://example.com/valid-art.png",
        shippingAddress: {
          name: "No Email Buyer",
          street: "123 Test St",
          city: "OKC",
          state: "OK",
          zip: "73101"
        }
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Missing required customer email: 'shippingAddress.email'");
  });

  it("should download artwork and save local /uploads path on confirmed order", async () => {
    const quoteId = "quo_dl_art";
    await mockDb.createQuote({
      quoteId,
      total: 0.35,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000).toISOString()
    });

    const paymentProof = Buffer.from(JSON.stringify({
      status: "PAID",
      paymentId: "tx_dl_art_123",
      amount: "0.35"
    })).toString("base64");

    const res = await request(app)
      .post("/api/v1/orders")
      .set("authorization-x402", paymentProof)
      .send({
        quoteId,
        designUrl: "https://example.com/mascot-art.png",
        shippingAddress: {
          name: "Artwork Tester",
          email: "art@example.com",
          street: "123 Design Blvd",
          city: "OKC",
          state: "OK",
          zip: "73102"
        }
      });

    expect(res.statusCode).toBe(201);
    expect(mockDb.createOrder).toHaveBeenCalled();
    const createdOrder = mockDb.createOrder.mock.calls[mockDb.createOrder.mock.calls.length - 1][0];
    expect(createdOrder.designImagePath).toMatch(/^\/uploads\/designImage-/);
    expect(createdOrder.designUrl).toBe("https://example.com/mascot-art.png");
    expect(createdOrder.shippingContact.email).toBe("art@example.com");
  });
});


