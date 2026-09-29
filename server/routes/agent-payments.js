import express from "express";
import { verifyAP2Mandate, verifyMandateBindings, computeCartDigest } from "../lib/ap2_crypto.js";
import { verifySettlementProof, getActiveSettlementMethods } from "../lib/settlement_verifier.js";

export default function createAgentPaymentsRouter(db) {
  const router = express.Router();

  function getSettlementContext() {
    const activeRails = getActiveSettlementMethods();
    const merchantWallet = process.env.BASE_MERCHANT_WALLET || "0x7F4d2a0518cC74835fa55dBA271A02d4f18cAE23";
    const settlementDetails = {
      base_usdc: {
        rail: "base_usdc",
        network: "base",
        chain_id: 8453,
        token_name: "USD Coin",
        token_symbol: "USDC",
        token_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        recipient_address: merchantWallet,
        decimals: 6
      },
      lightning: {
        rail: "lightning",
        description: "Lightning Network payment via LNURL/invoice preimage"
      }
    };
    return { activeRails, merchantWallet, settlementDetails };
  }

  // Helper function to handle AP2 & x402 payment validation and order creation
  async function handlePaymentProcessing(req, res) {
    const body = req.body || {};
    let paymentProof = req.headers["authorization-x402"] || req.headers["x-payment"] || req.headers["authorization"];
    let ap2Mandate = req.headers["x-ap2-mandate"] || req.headers["x-ap2-cart-mandate"] || body.ap2_mandate_jws || body.mandate;

    // Handle settlement passed in body (e.g. Gemini / AgentKit / Hermes payload)
    if (!paymentProof && body.settlement) {
      paymentProof = Buffer.from(JSON.stringify({
        status: "PAID",
        amount: body.settlement.amount || body.amount,
        paymentId: body.settlement.tx_hash || body.settlement.payment_hash || ("tx-" + Date.now()),
        tx_hash: body.settlement.tx_hash,
        payment_hash: body.settlement.payment_hash,
        preimage: body.settlement.preimage,
        rail: body.settlement.rail || (body.settlement.tx_hash ? "base_usdc" : "x402"),
        asset: body.settlement.asset || "USDC",
        network: body.settlement.network || "base",
        payer: body.settlement.payer_wallet || body.settlement.payer
      })).toString("base64");
    }

    const { activeRails, merchantWallet, settlementDetails } = getSettlementContext();

    if (!paymentProof) {
      // Return standard HTTP 402 challenge
      const quoteAmount = body.amount || (body.settlement && body.settlement.amount) || "15.00";
      return res.status(402).json({
        error: "Payment Required",
        protocol: "x402",
        ap2_support: true,
        quote: {
          amount: quoteAmount,
          currency: "USD",
          recipient: merchantWallet,
          settlement_methods: activeRails,
          settlement_details: settlementDetails
        },
        settlement_details: settlementDetails,
        discovery: {
          well_known_ap2: "/.well-known/ap2",
          well_known_mcp: "/.well-known/mcp.json",
          mcp_endpoint: "/api/mcp",
          quotes_endpoint: "/api/v1/quotes",
          orders_endpoint: "/api/v1/orders",
          docs: "/llms.txt",
          openapi: "/openapi.json"
        },
        instructions: "Payment required. For direct Base USDC settlement (Coinbase / web3), transfer funds to recipient_address and provide transaction hash in 'authorization-x402' header or body.settlement.tx_hash. AP2 Cart Mandate ('x-ap2-mandate') is optional for delegated AI agents."
      });
    }

    let verified = { success: false };
    try {
      let parsedMandate = null;
      let quoteId = body.quoteId || body.quote_id;

      // 1. If AP2 Mandate is provided, cryptographically verify it
      if (ap2Mandate) {
        parsedMandate = await verifyAP2Mandate(ap2Mandate, { audience: "splotch-creative-settlement" });
        quoteId = quoteId || parsedMandate.quoteId || parsedMandate.quote_id || (parsedMandate.cart_binding && parsedMandate.cart_binding.quote_id);
      }

      if (!quoteId) {
        return res.status(400).json({ error: "Missing required quoteId or quote_id" });
      }

      // 2. Validate Quote
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

      const shippingAddress = body.shippingAddress || body.shipping_destination || {};

      // 3. Cryptographically verify mandate bindings if mandate was supplied
      if (parsedMandate) {
        verifyMandateBindings(parsedMandate, storedQuote, shippingAddress);

        let maxSpendCents;
        if (parsedMandate.maxSpendCents !== undefined) {
          maxSpendCents = parseInt(parsedMandate.maxSpendCents, 10);
        } else if (parsedMandate.agentRules && parsedMandate.agentRules.maxSpendCents !== undefined) {
          maxSpendCents = parseInt(parsedMandate.agentRules.maxSpendCents, 10);
        } else if (parsedMandate.agent_rules?.max_amount?.amount !== undefined) {
          maxSpendCents = Math.round(parseFloat(parsedMandate.agent_rules.max_amount.amount) * 100);
        }

        if (maxSpendCents !== undefined) {
          const storedQuoteCents = Math.round(storedQuote.total * 100);
          if (isNaN(maxSpendCents) || maxSpendCents < 0 || storedQuoteCents > maxSpendCents) {
            return res.status(403).json({ error: "Agent mandate spending limit exceeded" });
          }
        }

        const customExpiryStr = parsedMandate.agentRules?.expiresAt || parsedMandate.agent_rules?.valid_until;
        if (customExpiryStr) {
          const customExpiry = new Date(customExpiryStr);
          if (isNaN(customExpiry.getTime()) || new Date() > customExpiry) {
            return res.status(403).json({ error: "Agent mandate expired" });
          }
        }
      }

      // 4. Verify Settlement Proof (Base USDC RPC, Lightning preimage, or valid simulated proof in non-prod)
      const settlementMeta = await verifySettlementProof(paymentProof, storedQuote);

      // 5. Verify payment amount matches quote
      const providedAmount = parseFloat(body.amount || (body.settlement && body.settlement.amount) || settlementMeta.amount);
      if (providedAmount !== storedQuote.total) {
        return res.status(400).json({ error: "Payment amount does not match stored quote" });
      }

      verified = {
        success: true,
        mandateId: parsedMandate ? (parsedMandate.mandateId || parsedMandate.mandate_id || ("man_" + Date.now())) : "direct_x402_settlement",
        paymentId: settlementMeta.paymentId,
        settlement: settlementMeta,
        amount: storedQuote.total,
        quote: storedQuote,
        quoteId: quoteId,
        hasMandate: Boolean(parsedMandate)
      };
    } catch (error) {
      if (error.message && error.message.includes("amount mismatch")) {
        return res.status(400).json({ error: "Payment amount does not match stored quote" });
      }
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
      order_id: orderId,
      status: "NEW",
      receivedAt: new Date().toISOString(),
      paymentId: verified.paymentId,
      amount: verified.amount,
      buyerType: "agent",
      settlementRail: verified.settlement?.rail || "x402",
      txHash: verified.settlement?.tx_hash || null,
      items: body.items || (verified.quote.spec ? [verified.quote.spec] : []),
      shippingAddress: body.shippingAddress || body.shipping_destination || {}
    };

    await db.createOrder(orderRecord);

    // Mark quote as consumed
    verified.quote.status = "CONSUMED";
    await db.updateQuote(verified.quote);

    return res.status(201).json({
      status: "CONFIRMED",
      orderId: orderRecord.orderId,
      order_id: orderRecord.orderId,
      quote_id: verified.quoteId,
      mandate_verification: verified.hasMandate ? {
        valid: true,
        mandate_id: verified.mandateId,
        agent_rules_enforced: true,
        within_budget: true
      } : {
        valid: true,
        type: "direct_x402_onchain",
        mandate_id: verified.mandateId
      },
      settlement_verification: {
        rail: verified.settlement?.rail || "x402",
        tx_status: "confirmed",
        payment_id: verified.paymentId,
        tx_hash: verified.settlement?.tx_hash
      },
      trackingUrl: `https://splotch.page/orders.html?id=${orderRecord.orderId}`,
      fulfillment_tracking_url: `https://splotch.page/api/v1/orders/${orderRecord.orderId}`
    });
  }

  // --- GET / OPTIONS /v1/payments/ap2 (Protocol Discovery & Inspection) ---
  const ap2ProtocolInfo = (req, res) => {
    const { activeRails, merchantWallet, settlementDetails } = getSettlementContext();
    res.setHeader("Content-Type", "application/json");
    res.json({
      status: activeRails.length > 0 ? "active" : "disabled",
      protocol: "x402",
      ap2_support: true,
      description: "Splotch Autonomous Agent Payment & Settlement Protocol Endpoint",
      methods_supported: ["GET", "POST", "OPTIONS"],
      required_headers: ["authorization-x402", "x-ap2-mandate", "X-Payment", "X-AP2-Mandate"],
      direct_settlement_headers: ["authorization-x402", "X-Payment"],
      optional_for_direct_x402: ["x-ap2-mandate", "X-AP2-Mandate"],
      settlement_methods: activeRails,
      settlement_details: settlementDetails,
      recipient: merchantWallet,
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
      instructions: "To complete a purchase, POST to this endpoint or /api/v1/orders with header 'authorization-x402' containing payment proof (or JSON body with settlement.tx_hash). AP2 Cart Mandates are supported but optional for direct crypto settlement."
    });
  };

  router.get("/v1/payments/ap2", ap2ProtocolInfo);
  router.options("/v1/payments/ap2", ap2ProtocolInfo);

  // --- POST /v1/payments/ap2 (Payment Execution) ---
  router.post("/v1/payments/ap2", handlePaymentProcessing);

  // --- REST Quoting API: POST /v1/quotes ---
  router.post("/v1/quotes", async (req, res) => {
    const { activeRails, merchantWallet, settlementDetails } = getSettlementContext();
    const body = req.body || {};
    let widthInches = body.widthInches;
    let heightInches = body.heightInches;
    let quantity = body.quantity;
    let material = body.material || "vinyl_matte";
    let cutType = body.cutType || "die_cut";
    let shape = body.shape || "custom_contour";

    // Support nested items array (e.g. Gemini / MCP schema)
    if ((!widthInches || !heightInches || !quantity) && Array.isArray(body.items) && body.items.length > 0) {
      const item = body.items[0];
      if (item.dimensions) {
        widthInches = item.dimensions.width_in || item.dimensions.widthInches || item.dimensions.width;
        heightInches = item.dimensions.height_in || item.dimensions.heightInches || item.dimensions.height;
      }
      quantity = item.quantity || quantity;
      material = item.material || material;
      cutType = item.cut_type || item.cutType || cutType;
      shape = item.shape || shape;
    }

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
    const isSpecialMaterial = material === "holographic" || material === "heavy_duty_pvc";
    const materialSurcharge = isSpecialMaterial ? 0.35 : 0.20;
    const unitPrice = parseFloat(((width * height * baseRate) + materialSurcharge).toFixed(2));
    const total = parseFloat((unitPrice * qty).toFixed(2));

    const quoteId = `quo_${Date.now()}`;
    const expiresAt = new Date(Date.now() + 30 * 60000).toISOString();

    const quoteRecord = {
      quoteId,
      quote_id: quoteId,
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
        cutType,
        shape
      }
    };

    await db.createQuote(quoteRecord);

    return res.status(201).json({
      quoteId,
      quote_id: quoteId,
      status: "valid",
      unitPrice,
      total,
      total_usd: total.toFixed(2),
      currency: "USD",
      pricing: {
        print_subtotal_usd: total.toFixed(2),
        tradeoff_discount_usd: "0.00",
        shipping_usd: "0.00",
        total_usd: total.toFixed(2)
      },
      settlement_methods: getActiveSettlementMethods(),
      settlement_details: settlementDetails,
      recipient: merchantWallet,
      ...(getActiveSettlementMethods().includes("base_usdc") ? {
        settlement_equivalents: {
          usdc: total.toFixed(2),
          chain_id: 8453,
          token_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          recipient_address: merchantWallet
        }
      } : {}),
      digest_sha256: Buffer.from(`${quoteId}:${total}`).toString("hex"),
      cart_digest: computeCartDigest(quoteRecord),
      validUntilMinutes: 30,
      expiresAt,
      expires_at: expiresAt,
      ap2_payment_endpoint: "/api/v1/payments/ap2",
      orders_endpoint: "/api/v1/orders",
      instructions: "To pay via Base USDC, transfer total_usd USDC on Base (chain 8453) to recipient_address and POST to /api/v1/orders with settlement.tx_hash. AP2 Cart Mandates are supported for delegated AI agents."
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
      order_id: order.orderId,
      status: order.status,
      receivedAt: order.receivedAt,
      amount: order.amount,
      trackingUrl: `https://splotch.page/orders.html?id=${order.orderId}`,
      fulfillment_tracking_url: `https://splotch.page/api/v1/orders/${order.orderId}`
    });
  });

  return router;
}
