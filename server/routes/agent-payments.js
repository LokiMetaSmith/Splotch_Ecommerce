import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import multer from "multer";
import { verifyAP2Mandate, verifyMandateBindings, computeCartDigest } from "../lib/ap2_crypto.js";
import { verifySettlementProof, getActiveSettlementMethods, isLightningEnabled, isBaseUsdcEnabled } from "../lib/settlement_verifier.js";
import { DEFAULT_SHIPPING_CONFIG } from "../lib/costCalc.js";
import { downloadAgentArtwork, detectImageBufferType } from "../lib/artwork_downloader.js";
import { generateProductionCutlineSvg, generateStickerProofSvg } from "../lib/cutline_generator.js";
import { dispatchOrderWebhook } from "../lib/webhook_dispatcher.js";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_UPLOADS_DIR = path.resolve(__dirname, "../uploads");

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(DEFAULT_UPLOADS_DIR)) {
      fs.mkdirSync(DEFAULT_UPLOADS_DIR, { recursive: true });
    }
    cb(null, DEFAULT_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    cb(null, `designImage-agent-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  }
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

export default function createAgentPaymentsRouter(db, options = {}) {
  const router = express.Router();
  const { scheduleEmail, scheduleTelegram, storageProvider, processIncomingOrderToDropBox } = options;

  function getSettlementContext() {
    const savedShipping = db.data?.config?.shipping || {};
    const shippingConfig = { ...DEFAULT_SHIPPING_CONFIG, ...savedShipping };
    const activeRails = [];
    if (shippingConfig.lightningEnabled !== false && isLightningEnabled()) {
      activeRails.push("lightning");
    }
    const merchantWallet = (shippingConfig.baseMerchantWallet && shippingConfig.baseMerchantWallet.startsWith("0x"))
      ? shippingConfig.baseMerchantWallet
      : (process.env.BASE_MERCHANT_WALLET || "0x7F4d2a0518cC74835fa55dBA271A02d4f18cAE23");

    if (shippingConfig.baseUsdcEnabled !== false && isBaseUsdcEnabled()) {
      activeRails.push("base_usdc");
    }

    const settlementDetails = {};
    if (activeRails.includes("base_usdc")) {
      settlementDetails.base_usdc = {
        rail: "base_usdc",
        network: "base",
        chain_id: 8453,
        token_name: "USD Coin",
        token_symbol: "USDC",
        token_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        recipient_address: merchantWallet,
        decimals: 6
      };
    }
    if (activeRails.includes("lightning")) {
      settlementDetails.lightning = {
        rail: "lightning",
        description: "Lightning Network payment via LNURL/invoice preimage"
      };
    }
    return { activeRails, merchantWallet, settlementDetails, shippingConfig };
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

      // 4. Verify Settlement Proof (Base USDC RPC, Lightning preimage, or valid simulated proof in non-prod)
      const settlementMeta = await verifySettlementProof(paymentProof, storedQuote, { merchantWallet });

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
    const rawShip = body.shippingAddress || body.shipping_destination || {};
    const customerEmail = (rawShip.email || body.email || "").trim();
    if (!customerEmail || !customerEmail.includes("@") || customerEmail.toLowerCase() === "agent@splotch.page") {
      return res.status(400).json({
        error: "Missing required customer email: 'shippingAddress.email' is required for order confirmation and USPS tracking updates."
      });
    }

    const rawItems = body.items || (verified.quote.spec ? [verified.quote.spec] : []);
    const firstItem = (rawItems && rawItems[0]) || verified.quote.spec || {};
    const rawDesignUrl = (
      body.designUrl ||
      body.design_url ||
      body.artwork ||
      body.artworkBase64 ||
      body.designBase64 ||
      body.image ||
      firstItem.designUrl ||
      firstItem.artwork_url ||
      firstItem.artwork ||
      ""
    ).trim();
    if (!rawDesignUrl) {
      return res.status(400).json({
        error: "Missing required order field: 'designUrl' (URL, Base64 data URI, raw Base64, or SVG) is required to print custom stickers."
      });
    }

    let localDesignPath;
    try {
      localDesignPath = await downloadAgentArtwork(rawDesignUrl);
    } catch (dlErr) {
      return res.status(400).json({
        error: `Failed to retrieve artwork from 'designUrl': ${dlErr.message}`
      });
    }

    const orderId = "ord_" + Date.now();
    const nameStr = (rawShip.name || rawShip.recipient_name || "").trim();
    const nameParts = nameStr ? nameStr.split(/\s+/) : ["Agent", "Customer"];
    const givenName = nameParts[0] || "Agent";
    const familyName = nameParts.slice(1).join(" ") || "";

    const contactObj = {
      givenName,
      familyName,
      email: customerEmail,
      addressLines: [rawShip.street || rawShip.street_address || rawShip.address_line_1].filter(Boolean),
      locality: rawShip.city || rawShip.locality || "",
      administrativeDistrictLevel1: rawShip.state || rawShip.administrative_area || "",
      postalCode: rawShip.zip || rawShip.postal_code || "",
      country: rawShip.country || "US"
    };

    const amountInCents = Math.round(verified.amount * 100);
    const webhookUrl = (body.webhook_url || body.webhookUrl || "").trim();

    const orderRecord = {
      orderId: orderId,
      order_id: orderId,
      status: "NEW",
      receivedAt: new Date().toISOString(),
      paymentId: verified.paymentId,
      amount: amountInCents,
      amountCents: amountInCents,
      amountUsd: verified.amount,
      buyerType: "agent",
      settlementRail: verified.settlement?.rail || "x402",
      txHash: verified.settlement?.tx_hash || null,
      webhookUrl: webhookUrl || null,
      webhook_url: webhookUrl || null,
      customerEmail: customerEmail,
      email: customerEmail,
      customerDetails: {
        billing: {
          email: customerEmail,
          name: nameStr
        }
      },
      quantity: firstItem.quantity || verified.quote.spec?.quantity || 1,
      widthInches: firstItem.widthInches || verified.quote.spec?.widthInches || null,
      heightInches: firstItem.heightInches || verified.quote.spec?.heightInches || null,
      material: firstItem.material || verified.quote.spec?.material || "vinyl_matte",
      cutType: firstItem.cutType || firstItem.cut_type || verified.quote.spec?.cutType || "die_cut",
      orderDetails: {
        quantity: firstItem.quantity || verified.quote.spec?.quantity || 1,
        widthInches: firstItem.widthInches || verified.quote.spec?.widthInches || null,
        heightInches: firstItem.heightInches || verified.quote.spec?.heightInches || null,
        material: firstItem.material || verified.quote.spec?.material || "vinyl_matte",
        cutType: firstItem.cutType || firstItem.cut_type || verified.quote.spec?.cutType || "die_cut",
        resolution: "dpi_300"
      },
      items: rawItems,
      shippingAddress: rawShip,
      shippingContact: contactObj,
      billingContact: contactObj,
      deliveryMethod: (body.shippingMethod === "pickup" || body.delivery?.method === "pickup") ? "pickup" : "ship",
      designImagePath: localDesignPath,
      designUrl: rawDesignUrl
    };

    // Auto-generate standardized Roland/Graphtec production cutline SVG (White_Layer, Kiss-Cut, Die-Cut)
    try {
      const cutlineResult = await generateProductionCutlineSvg({
        artworkPath: localDesignPath,
        widthInches: orderRecord.widthInches || 2.0,
        heightInches: orderRecord.heightInches || 2.0,
        cutType: orderRecord.cutType || "die_cut",
        material: orderRecord.material || "vinyl_matte",
        uploadsDir: DEFAULT_UPLOADS_DIR
      });
      orderRecord.orderDetails.cutLinePath = cutlineResult.cutLinePath;
      orderRecord.cutLinePath = cutlineResult.cutLinePath;
    } catch (cutErr) {
      console.warn(`[AGENT-PAYMENTS] Auto-cutline generation skipped: ${cutErr.message}`);
    }

    await db.createOrder(orderRecord);

    // Mark quote as consumed
    verified.quote.status = "CONSUMED";
    await db.updateQuote(verified.quote);

    // Physical USB drop box processing for print shop hardware
    if (processIncomingOrderToDropBox && storageProvider) {
      processIncomingOrderToDropBox(orderRecord, storageProvider).catch((err) => {
        console.warn(`[DropBox] Agent order USB copy failed: ${err.message}`);
      });
    }

    // Schedule Order Confirmation Email to customerEmail
    if (scheduleEmail) {
      const orderDate = new Date(orderRecord.receivedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      });
      const formattedAmount = (orderRecord.amountUsd !== undefined ? orderRecord.amountUsd : (orderRecord.amount / 100)).toFixed(2);
      const qty = orderRecord.quantity || 1;
      const mat = orderRecord.material || "matte vinyl";
      const cut = orderRecord.cutType || "die cut";
      const w = orderRecord.widthInches || 2.0;
      const h = orderRecord.heightInches || 2.0;

      const emailData = {
        to: customerEmail,
        subject: `Order Confirmed! Your Splotch Sticker Order #${orderRecord.orderId}`,
        text: `Hey ${givenName},\n\nThank you for ordering with Splotch! We've received your order and payment ($${formattedAmount}).\n\nOrder Details:\n• Order ID: ${orderRecord.orderId}\n• Date: ${orderDate}\n• Product: ${qty}x Custom Stickers (${w}" × ${h}", ${mat}, ${cut})\n• Status: Confirmed & Queued for Printing\n\nShipping Address:\n${rawShip.name || givenName}\n${rawShip.street || ""}\n${rawShip.city || ""}, ${rawShip.state || ""} ${rawShip.zip || ""}\n\nYou can track your order status anytime here:\nhttps://splotch.page/orders.html?id=${orderRecord.orderId}\n\nWe'll send you another email with USPS tracking as soon as your stickers ship!\n\nBest,\nSplotch Print Shop Team`,
        html: `
          <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
            <h2 style="color: #0f172a; margin-bottom: 8px;">Order Confirmed! 🎉</h2>
            <p style="font-size: 16px; margin-top: 0;">Hey <strong>${escapeHtml(givenName)}</strong>, thank you for ordering with Splotch!</p>
            <p>We've received your order and confirmed payment of <strong>$${escapeHtml(formattedAmount)}</strong>. Your stickers have been queued for production at our print shop.</p>
            
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <h3 style="margin-top: 0; margin-bottom: 12px; color: #0f172a; font-size: 15px;">Order Summary</h3>
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Order ID:</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right;">${escapeHtml(orderRecord.orderId)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Item:</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right;">${qty}× ${escapeHtml(w)}" × ${escapeHtml(h)}" ${escapeHtml(cut)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Material:</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right;">${escapeHtml(mat)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Total Paid:</td>
                  <td style="padding: 6px 0; font-weight: 700; text-align: right; color: #047857;">$${escapeHtml(formattedAmount)}</td>
                </tr>
              </table>
            </div>

            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <h3 style="margin-top: 0; margin-bottom: 8px; color: #0f172a; font-size: 15px;">Shipping Destination</h3>
              <p style="margin: 0; font-size: 14px; line-height: 1.5;">
                ${escapeHtml(rawShip.name || givenName)}<br>
                ${escapeHtml(rawShip.street || "")}<br>
                ${escapeHtml(rawShip.city || "")}, ${escapeHtml(rawShip.state || "")} ${escapeHtml(rawShip.zip || "")}
              </p>
            </div>

            <p style="font-size: 14px; color: #475569;">
              You can track your order status in real time anytime at:<br>
              <a href="https://splotch.page/orders.html?id=${orderRecord.orderId}" style="color: #2563eb; font-weight: 600;">https://splotch.page/orders.html?id=${orderRecord.orderId}</a>
            </p>

            <p style="font-size: 14px; color: #475569;">
              We'll send you an update with your USPS tracking link as soon as your stickers are printed and packed.
            </p>

            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="font-size: 13px; color: #94a3b8; margin: 0;">Splotch Print Shop • 7712 S. Penn Ave, Oklahoma City, OK 73159</p>
          </div>
        `
      };
      try {
        await scheduleEmail("order-confirmation", emailData);
      } catch (eErr) {
        console.warn(`[AGENT-PAYMENTS] Confirmation email dispatch failed: ${eErr.message}`);
      }
    }

    // Trigger Agent Webhook if registered
    if (orderRecord.webhookUrl) {
      dispatchOrderWebhook(orderRecord, "order.created").catch((wErr) => {
        console.warn(`[AGENT-PAYMENTS] Webhook creation dispatch failed: ${wErr.message}`);
      });
    }

    // Trigger Telegram notification
    if (scheduleTelegram) {
      scheduleTelegram("send-new-order", { orderId: orderRecord.orderId }).catch(() => {});
    }

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
      fulfillment_tracking_url: `https://splotch.page/api/v1/orders/${orderRecord.orderId}`,
      cutline_path: orderRecord.orderDetails?.cutLinePath || null,
      webhook_url: orderRecord.webhookUrl || null
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
    const { activeRails, merchantWallet, settlementDetails, shippingConfig } = getSettlementContext();
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
    const printSubtotal = parseFloat((unitPrice * qty).toFixed(2));

    const isPickup = body.shippingMethod === "pickup" || body.delivery?.method === "pickup";
    const canUseEnvelope = shippingConfig.envelopeShippingEnabled !== false && qty <= 10 && width <= 4.5 && height <= 6.5;
    const isEnvelope = !isPickup && (body.shippingMethod === "envelope" || canUseEnvelope);

    let shippingCents = 0;
    let shippingMethodLabel = "pickup";

    if (isPickup) {
      shippingCents = 0;
      shippingMethodLabel = "pickup";
    } else if (isEnvelope) {
      shippingCents = (shippingConfig.envelopeShippingCents ?? 125) + (shippingConfig.envelopeHandlingFeeCents ?? 25);
      shippingMethodLabel = "usps_economy_envelope";
    } else if (shippingConfig.parcelShippingEnabled !== false) {
      shippingCents = 430 + (shippingConfig.baseHandlingFeeCents ?? 103);
      shippingMethodLabel = "usps_tracked_parcel";
    }

    const shippingUsd = parseFloat((shippingCents / 100).toFixed(2));
    const total = parseFloat((printSubtotal + shippingUsd).toFixed(2));

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
      pricing: {
        print_subtotal_usd: printSubtotal.toFixed(2),
        tradeoff_discount_usd: "0.00",
        shipping_usd: shippingUsd.toFixed(2),
        shipping_method: shippingMethodLabel,
        total_usd: total.toFixed(2)
      },
      spec: {
        widthInches: width,
        heightInches: height,
        quantity: qty,
        material,
        cutType,
        shape,
        shippingMethod: shippingMethodLabel
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
        print_subtotal_usd: printSubtotal.toFixed(2),
        tradeoff_discount_usd: "0.00",
        shipping_usd: shippingUsd.toFixed(2),
        shipping_method: shippingMethodLabel,
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
      amount: order.amountUsd !== undefined ? order.amountUsd : (order.amount >= 100 ? parseFloat((order.amount / 100).toFixed(2)) : order.amount),
      amountCents: order.amountCents || (order.amount >= 100 ? order.amount : Math.round(order.amount * 100)),
      quantity: order.quantity || order.orderDetails?.quantity || 1,
      trackingUrl: `https://splotch.page/orders.html?id=${order.orderId}`,
      fulfillment_tracking_url: `https://splotch.page/api/v1/orders/${order.orderId}`
    });
  });

  // --- Headless Direct Artwork Upload: POST /v1/upload ---
  router.post(
    "/v1/upload",
    (req, res, next) => {
      if (req.is("multipart/form-data")) {
        return upload.any()(req, res, (err) => {
          if (err) {
            return res.status(400).json({ error: `Upload error: ${err.message}` });
          }
          const file = req.files && req.files[0];
          if (!file) {
            return res.status(400).json({ error: "No file provided in multipart upload" });
          }
          const designUrl = `/uploads/${file.filename}`;
          return res.status(201).json({
            success: true,
            designUrl,
            url: `https://splotch.page${designUrl}`,
            filename: file.filename,
            sizeBytes: file.size
          });
        });
      }
      next();
    },
    express.raw({ type: ["image/*", "application/octet-stream"], limit: "25mb" }),
    async (req, res) => {
      try {
        // 1. Raw binary buffer
        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
          const detected = detectImageBufferType(req.body) || { ext: ".png", mime: "image/png" };
          const filename = `designImage-agent-${Date.now()}-${randomUUID().slice(0, 8)}${detected.ext}`;
          const targetPath = path.join(DEFAULT_UPLOADS_DIR, filename);
          if (!fs.existsSync(DEFAULT_UPLOADS_DIR)) fs.mkdirSync(DEFAULT_UPLOADS_DIR, { recursive: true });
          await fs.promises.writeFile(targetPath, req.body);
          const designUrl = `/uploads/${filename}`;
          return res.status(201).json({
            success: true,
            designUrl,
            url: `https://splotch.page${designUrl}`,
            filename,
            sizeBytes: req.body.length
          });
        }

        // 2. JSON body or string
        const body = req.body || {};
        const rawArtwork = (
          (typeof body === "string" ? body : "") ||
          body.artwork ||
          body.artworkBase64 ||
          body.designUrl ||
          body.designBase64 ||
          body.image ||
          body.svg ||
          ""
        ).trim();

        if (!rawArtwork) {
          return res.status(400).json({
            error: "Missing artwork in upload. Send binary image bytes, multipart file, or JSON with 'artwork' (Base64 data URI, raw Base64, raw SVG markup, or URL)."
          });
        }

        const designUrl = await downloadAgentArtwork(rawArtwork, DEFAULT_UPLOADS_DIR);
        const filename = path.basename(designUrl);
        return res.status(201).json({
          success: true,
          designUrl,
          url: `https://splotch.page${designUrl}`,
          filename
        });
      } catch (err) {
        return res.status(400).json({ error: `Upload failed: ${err.message}` });
      }
    }
  );

  // --- Sticker Proof / Preview Endpoint: POST /v1/preview ---
  router.post(
    "/v1/preview",
    (req, res, next) => {
      if (req.is("multipart/form-data")) {
        return upload.any()(req, res, (err) => {
          if (err) {
            return res.status(400).json({ error: `Upload error: ${err.message}` });
          }
          next();
        });
      }
      next();
    },
    express.raw({ type: ["image/*", "application/octet-stream"], limit: "25mb" }),
    async (req, res) => {
      try {
        let localArtPath = "";
        const body = req.body || {};

        if (req.files && req.files[0]) {
          localArtPath = path.join(DEFAULT_UPLOADS_DIR, req.files[0].filename);
        } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
          const detected = detectImageBufferType(req.body) || { ext: ".png", mime: "image/png" };
          const filename = `previewArt-${Date.now()}-${randomUUID().slice(0, 8)}${detected.ext}`;
          localArtPath = path.join(DEFAULT_UPLOADS_DIR, filename);
          if (!fs.existsSync(DEFAULT_UPLOADS_DIR)) fs.mkdirSync(DEFAULT_UPLOADS_DIR, { recursive: true });
          await fs.promises.writeFile(localArtPath, req.body);
        } else {
          const rawArtwork = (
            (typeof body === "string" ? body : "") ||
            body.artwork ||
            body.artworkBase64 ||
            body.designUrl ||
            body.design_url ||
            body.designBase64 ||
            body.image ||
            body.svg ||
            ""
          ).trim();

          if (!rawArtwork) {
            return res.status(400).json({
              error: "Missing artwork for preview. Provide 'artwork' (Base64 data URI, raw Base64, SVG markup, or URL), binary image bytes, or multipart upload."
            });
          }

          const designUrl = await downloadAgentArtwork(rawArtwork, DEFAULT_UPLOADS_DIR);
          localArtPath = path.join(DEFAULT_UPLOADS_DIR, path.basename(designUrl));
        }

        const widthInches = parseFloat(body.widthInches || body.width_inches || body.width) || 2.0;
        const heightInches = parseFloat(body.heightInches || body.height_inches || body.height) || 2.0;
        const material = body.material || "vinyl_matte";
        const cutType = body.cutType || body.cut_type || "die_cut";

        const proof = await generateStickerProofSvg({
          artworkPath: localArtPath,
          widthInches,
          heightInches,
          material,
          cutType,
          uploadsDir: DEFAULT_UPLOADS_DIR
        });

        return res.status(200).json({
          success: true,
          previewUrl: proof.previewUrl,
          url: proof.url,
          widthInches: proof.widthInches,
          heightInches: proof.heightInches,
          material: proof.material,
          cutType: proof.cutType
        });
      } catch (err) {
        return res.status(400).json({ error: `Failed to generate sticker preview: ${err.message}` });
      }
    }
  );

  return router;
}
