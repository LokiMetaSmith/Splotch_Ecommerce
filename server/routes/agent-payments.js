import express from "express";
import { verifyAP2Mandate } from "../lib/ap2_crypto.js";

export default function createAgentPaymentsRouter(db) {
  const router = express.Router();

  router.post("/v1/payments/ap2", async (req, res) => {
    const paymentProof = req.headers["authorization-x402"];
    const ap2Mandate = req.headers["x-ap2-mandate"];
    const body = req.body || {};

    if (!paymentProof || !ap2Mandate) {
      // Return standard HTTP 402 challenge, requesting both x402 payment proof and AP2 mandate
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
        instructions: "Include authorization header 'authorization-x402' for payment proof and 'x-ap2-mandate' for the signed AP2 Cart Mandate."
      });
    }

    let verified = { success: false };
    try {
      // Cryptographically verify the AP2 Mandate using jose
      // We also enforce audience to verify merchant identity, as specified by AP2 rules.
      const parsedMandate = await verifyAP2Mandate(ap2Mandate, { audience: "splotch-creative-settlement" });

      // We still simulate the paymentProof parsing for now as x402 is out of scope of AP2 crypto
      const parsedProof = JSON.parse(Buffer.from(paymentProof, 'base64').toString('utf-8'));

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

        // We leverage JWT exp if available, though agentRules might be passed in for legacy compat.
        // If maxSpendCents is specified, we must validate it against storedQuote.total
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

        let customExpiry;
        if (parsedMandate.agentRules && parsedMandate.agentRules.expiresAt) {
            customExpiry = new Date(parsedMandate.agentRules.expiresAt);
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
    const existingOrders = await db.getAllOrders() || [];
    const isDuplicatePayment = existingOrders.some(order => order.paymentId === verified.paymentId);
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
        items: body.items || [],
        shippingAddress: body.shippingAddress || {}
    };

    await db.createOrder(orderRecord);

    // Mark quote as consumed
    verified.quote.status = "CONSUMED";
    await db.updateQuote(verified.quote);

    return res.status(201).json({
      status: "CONFIRMED",
      orderId: orderRecord.orderId,
      trackingUrl: `https://splotch.shop/orders.html?id=${orderRecord.orderId}`
    });
  });

  return router;
}
