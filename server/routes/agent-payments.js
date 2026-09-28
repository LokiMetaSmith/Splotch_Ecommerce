import express from "express";
import { verifyAP2Mandate } from "../lib/ap2_crypto.js";

export default function createAgentPaymentsRouter(db) {
  const router = express.Router();

  // Helper function to handle AP2 & x402 payment validation and order creation
  async function handlePaymentProcessing(req, res) {
    const paymentProof = req.headers["authorization-x402"];
    const ap2Mandate = req.headers["x-ap2-mandate"];
    const body = req.body || {};

    if (!paymentProof || !ap2Mandate) {
      // Return standard HTTP 402 challenge
      return res.status(402).json({
        error: "Payment Required",
        protocol: "x402",
        ap2_support: true,
        quote: {
          amount: body.amount || "15.00",
          currency: "USD",
          recipient: "splotch-creative-settlement",
          settlement_methods: ["lightning", "base_usdc"]
        },
        discovery: {
          well_known_ap2: "/.well-known/ap2",
          well_known_mcp: "/.well-known/mcp.json",
          mcp_endpoint: "/api/mcp",
          quotes_endpoint: "/api/v1/quotes",
          orders_endpoint: "/api/v1/orders",
          docs: "/llms.txt",
          openapi: "/openapi.json"
        },
        instructions: "Include authorization header 'authorization-x402' for payment proof and 'x-ap2-mandate' for the signed AP2 Cart Mandate."
      });
    }

    let verified = { success: false };
    try {
      // Cryptographically verify the AP2 Mandate using jose
      const parsedMandate = await verifyAP2Mandate(ap2Mandate, { audience: "splotch-creative-settlement" });

      // Parse payment proof
      const parsedProof = JSON.parse(Buffer.from(paymentProof, "base64").toString("utf-8"));

      if (parsedProof.status === "PAID" && parsedMandate.intentId) {
        // Validate Quote
        const quoteId = parsedMandate.quoteId || body.quoteId;
        const storedQuote = await db.getQuote(quoteId);

        if (!storedQuote) {
          return res.status(404).json({ error: "Quote not found or invalid quoteId" });
        }

        if (storedQuote.status === "CONSUMED") {
          return res.status(400).json({ error: "Quote has already been consumed (Replay Protection)" });
        }

        if (new Date() > new Date(storedQuote.expiresAt)) {
          return res.status(400).json({ error: "Quote has expired" });
        }

        const providedAmount = parseFloat(body.amount || parsedProof.amount);
        if (providedAmount !== storedQuote.total) {
          return res.status(400).json({ error: "Payment amount does not match stored quote" });
        }

        // Validate maxSpendCents if present
        let maxSpendCents;
        if (parsedMandate.maxSpendCents !== undefined) {
          maxSpendCents = parseInt(parsedMandate.maxSpendCents, 10);
        } else if (parsedMandate.agentRules && parsedMandate.agentRules.maxSpendCents !== undefined) {
          maxSpendCents = parseInt(parsedMandate.agentRules.maxSpendCents, 10);
        }

        if (maxSpendCents !== undefined) {
          const storedQuoteCents = Math.round(storedQuote.total * 100);
          if (isNaN(maxSpendCents) || maxSpendCents < 0 || storedQuoteCents > maxSpendCents) {
            return res.status(403).json({ error: "Agent mandate spending limit exceeded" });
          }
        }

        // Validate custom expiration in agentRules if present
        if (parsedMandate.agentRules && parsedMandate.agentRules.expiresAt) {
          const customExpiry = new Date(parsedMandate.agentRules.expiresAt);
          if (isNaN(customExpiry.getTime()) || new Date() > customExpiry) {
            return res.status(403).json({ error: "Agent mandate expired" });
          }
        }

        verified = {
          success: true,
          mandateId: parsedMandate.mandateId || ("mandate-" + Date.now()),
          paymentId: parsedProof.paymentId || ("x402-payment-" + Date.now()),
          amount: storedQuote.total,
          quote: storedQuote
        };
      }
    } catch (error) {
      verified.success = false;
      verified.errorMsg = error.message;
    }

    if (!verified.success) {
      return res.status(403).json({ error: "Cryptographic validation failed for AP2 mandate or x402 payment proof: " + (verified.errorMsg || "") });
    }

    // Replay Protection: Check if paymentId already exists
    const existingOrders = (await db.getAllOrders()) || [];
    const isDuplicatePayment = existingOrders.some((order) => order.paymentId === verified.paymentId);
    if (isDuplicatePayment) {
      return res.status(400).json({ error: "Payment proof has already been processed (Replay Protection)" });
    }

    // Create real order record mapping incoming request
    const orderId = "ord_" + Date.now();
    const orderRecord = {
      orderId: orderId,
      status: "NEW",
      receivedAt: new Date().toISOString(),
      paymentId: verified.paymentId,
      amount: verified.amount,
      buyerType: "agent",
      items: body.items || (verified.quote.spec ? [verified.quote.spec] : []),
      shippingAddress: body.shippingAddress || {}
    };

    await db.createOrder(orderRecord);

    // Mark quote as consumed
    verified.quote.status = "CONSUMED";
    await db.updateQuote(verified.quote);

    return res.status(201).json({
      status: "CONFIRMED",
      orderId: orderRecord.orderId,
      trackingUrl: `https://splotch.page/orders.html?id=${orderRecord.orderId}`
    });
  }

  // --- GET / OPTIONS /v1/payments/ap2 (Protocol Discovery & Inspection) ---
  const ap2ProtocolInfo = (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.json({
      status: "active",
      protocol: "x402",
      ap2_support: true,
      description: "Splotch Autonomous Agent Payment & Settlement Protocol Endpoint",
      methods_supported: ["GET", "POST", "OPTIONS"],
      required_headers: ["authorization-x402", "x-ap2-mandate"],
      settlement_methods: ["lightning", "base_usdc"],
      recipient: "splotch-creative-settlement",
      default_quote: {
        amount: "15.00",
        currency: "USD"
      },
      discovery: {
        well_known_ap2: "/.well-known/ap2",
        well_known_mcp: "/.well-known/mcp.json",
        mcp_endpoint: "/api/mcp",
        quotes_endpoint: "/api/v1/quotes",
        orders_endpoint: "/api/v1/orders",
        docs: "/llms.txt",
        openapi: "/openapi.json"
      },
      instructions: "To complete a purchase, POST to this endpoint or /api/v1/orders with header 'authorization-x402' containing payment proof and header 'x-ap2-mandate' containing the signed AP2 Cart Mandate JWT."
    });
  };

  router.get("/v1/payments/ap2", ap2ProtocolInfo);
  router.options("/v1/payments/ap2", ap2ProtocolInfo);

  // --- POST /v1/payments/ap2 (Payment Execution) ---
  router.post("/v1/payments/ap2", handlePaymentProcessing);

  // --- REST Quoting API: POST /v1/quotes ---
  router.post("/v1/quotes", async (req, res) => {
    const { widthInches, heightInches, quantity, material = "vinyl_matte", cutType = "die_cut" } = req.body || {};

    if (!widthInches || !heightInches || !quantity) {
      return res.status(400).json({
        error: "Missing required quote fields. widthInches, heightInches, and quantity are required."
      });
    }

    const width = parseFloat(widthInches);
    const height = parseFloat(heightInches);
    const qty = parseInt(quantity, 10);

    if (isNaN(width) || width <= 0 || isNaN(height) || height <= 0 || isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: "Invalid dimensions or quantity" });
    }

    const baseRate = 0.15;
    const materialSurcharge = material === "holographic" ? 0.35 : 0.20;
    const unitPrice = parseFloat(((width * height * baseRate) + materialSurcharge).toFixed(2));
    const total = parseFloat((unitPrice * qty).toFixed(2));

    const quoteId = `quote_${Date.now()}`;
    const expiresAt = new Date(Date.now() + 30 * 60000).toISOString();

    const quoteRecord = {
      quoteId,
      unitPrice,
      total,
      currency: "USD",
      expiresAt,
      status: "PENDING",
      spec: {
        widthInches: width,
        heightInches: height,
        quantity: qty,
        material,
        cutType
      }
    };

    await db.createQuote(quoteRecord);

    return res.status(201).json({
      quoteId,
      unitPrice,
      total,
      currency: "USD",
      validUntilMinutes: 30,
      expiresAt,
      ap2_payment_endpoint: "/api/v1/payments/ap2",
      orders_endpoint: "/api/v1/orders",
      instructions: "Sign an AP2 Cart Mandate with maxSpendCents >= required amount, and POST to /api/v1/orders or /api/v1/payments/ap2 with headers 'authorization-x402' and 'x-ap2-mandate'."
    });
  });

  // --- GET /v1/quotes/:quoteId ---
  router.get("/v1/quotes/:quoteId", async (req, res) => {
    const quote = await db.getQuote(req.params.quoteId);
    if (!quote) {
      return res.status(404).json({ error: "Quote not found" });
    }
    return res.json(quote);
  });

  // --- Headless Order Endpoint: POST /v1/orders ---
  router.post("/v1/orders", handlePaymentProcessing);

  // --- GET /v1/orders/:orderId ---
  router.get("/v1/orders/:orderId", async (req, res) => {
    const order = await db.getOrder(req.params.orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    return res.json({
      orderId: order.orderId,
      status: order.status,
      receivedAt: order.receivedAt,
      amount: order.amount,
      trackingUrl: `https://splotch.page/orders.html?id=${order.orderId}`
    });
  });

  return router;
}
