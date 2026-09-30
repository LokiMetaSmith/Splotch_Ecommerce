import request from "supertest";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jest } from "@jest/globals";
import createAgentPaymentsRouter from "../routes/agent-payments.js";
import { generateProductionCutlineSvg, generateStickerProofSvg } from "../lib/cutline_generator.js";
import { dispatchOrderWebhook } from "../lib/webhook_dispatcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, "../uploads");

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_BASE64}`;
const SIMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="purple"/></svg>`;

describe("Agent Advanced Features: Previews, Auto-Cutlines, Webhooks & Emails", () => {
  let app;
  let mockDb;
  let inMemoryQuotes;
  let inMemoryOrders;
  let scheduledEmails;
  let scheduledTelegrams;
  let scheduleEmailMock;
  let scheduleTelegramMock;

  beforeEach(() => {
    inMemoryQuotes = new Map();
    inMemoryOrders = [];
    scheduledEmails = [];
    scheduledTelegrams = [];

    mockDb = {
      createOrder: jest.fn(async (order) => {
        inMemoryOrders.push(order);
        return order;
      }),
      getOrder: jest.fn(async (id) => inMemoryOrders.find(o => o.orderId === id)),
      getQuote: jest.fn(async (id) => inMemoryQuotes.get(id)),
      createQuote: jest.fn(async (quote) => {
        inMemoryQuotes.set(quote.quoteId, quote);
        return quote;
      }),
      updateQuote: jest.fn(async (quote) => {
        inMemoryQuotes.set(quote.quoteId, quote);
        return quote;
      }),
      getAllOrders: jest.fn(async () => inMemoryOrders)
    };

    scheduleEmailMock = jest.fn(async (jobName, data) => {
      scheduledEmails.push({ jobName, data });
    });

    scheduleTelegramMock = jest.fn(async (jobName, data) => {
      scheduledTelegrams.push({ jobName, data });
    });

    app = express();
    app.use(express.json({ limit: "25mb" }));
    app.use("/api", createAgentPaymentsRouter(mockDb, {
      scheduleEmail: scheduleEmailMock,
      scheduleTelegram: scheduleTelegramMock
    }));
  });

  describe("Sticker Proof / Preview Endpoint (POST /api/v1/preview)", () => {
    it("should generate a studio sticker proof from Base64 artwork", async () => {
      const res = await request(app)
        .post("/api/v1/preview")
        .send({
          artwork: TINY_PNG_DATA_URI,
          widthInches: 3.0,
          heightInches: 2.0,
          material: "holographic",
          cutType: "die_cut"
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.previewUrl).toMatch(/^\/uploads\/preview-agent-.+\.svg$/);
      expect(res.body.widthInches).toBe(3.0);
      expect(res.body.heightInches).toBe(2.0);
      expect(res.body.material).toBe("holographic");

      // Verify physical file was written and contains SVG markup with drop shadow and badges
      const absPath = path.join(UPLOADS_DIR, path.basename(res.body.previewUrl));
      expect(fs.existsSync(absPath)).toBe(true);
      const svgContent = await fs.promises.readFile(absPath, "utf8");
      expect(svgContent).toContain("Splotch Print Proof");
      expect(svgContent).toContain("Holographic Vinyl");
      expect(svgContent).toContain("id=\"sticker-shadow\"");
    });

    it("should generate a proof from raw SVG XML markup", async () => {
      const res = await request(app)
        .post("/api/v1/preview")
        .send({
          artwork: SIMPLE_SVG,
          widthInches: 2.5,
          heightInches: 2.5,
          material: "vinyl_gloss",
          cutType: "kiss_cut"
        });

      expect(res.status).toBe(200);
      expect(res.body.previewUrl).toBeTruthy();
      const absPath = path.join(UPLOADS_DIR, path.basename(res.body.previewUrl));
      const content = await fs.promises.readFile(absPath, "utf8");
      expect(content).toContain("Gloss Vinyl");
      expect(content).toContain("Kiss Cut");
      expect(content).toContain("circle cx=\"50\"");
    });

    it("should return 400 if artwork is missing", async () => {
      const res = await request(app)
        .post("/api/v1/preview")
        .send({ widthInches: 2.0, heightInches: 2.0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing artwork/i);
    });
  });

  describe("Auto-Cutline & White Underbase Generation (POST /api/v1/orders)", () => {
    let validQuote;

    beforeEach(async () => {
      // Create a valid quote
      const quoteRes = await request(app)
        .post("/api/v1/quotes")
        .send({
          widthInches: 2.0,
          heightInches: 2.0,
          quantity: 10,
          material: "vinyl_matte",
          cutType: "die_cut"
        });

      expect(quoteRes.status).toBe(201);
      validQuote = quoteRes.body;
    });

    it("should automatically generate Roland/Graphtec production cutline SVG with White, Kiss, and Die layers", async () => {
      const paymentProof = Buffer.from(JSON.stringify({
        status: "PAID",
        amount: validQuote.total_usd,
        paymentId: "tx-test-auto-cutline-" + Date.now(),
        rail: "base_usdc",
        tx_hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
      })).toString("base64");

      const res = await request(app)
        .post("/api/v1/orders")
        .set("authorization-x402", paymentProof)
        .send({
          quoteId: validQuote.quote_id,
          amount: validQuote.total_usd,
          artwork: SIMPLE_SVG,
          webhook_url: "https://example.com/agent-webhook",
          shippingAddress: {
            name: "Agent Buyer",
            email: "buyer@example.com",
            street: "123 Robot Way",
            city: "Austin",
            state: "TX",
            zip: "78701"
          }
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("CONFIRMED");
      expect(res.body.cutline_path).toMatch(/^\/uploads\/cutLineFile-agent-.+\.svg$/);
      expect(res.body.webhook_url).toBe("https://example.com/agent-webhook");

      // Verify physical cutline file contains Roland/Graphtec layers
      const cutlineAbsPath = path.join(UPLOADS_DIR, path.basename(res.body.cutline_path));
      expect(fs.existsSync(cutlineAbsPath)).toBe(true);

      const cutlineXml = await fs.promises.readFile(cutlineAbsPath, "utf8");
      expect(cutlineXml).toContain("id=\"White_Layer\"");
      expect(cutlineXml).toContain("id=\"Cmyk_art_Layer\"");
      expect(cutlineXml).toContain("id=\"Kiss-Cut\"");
      expect(cutlineXml).toContain("id=\"Die-Cut\"");
    });
  });

  describe("Automated Order Confirmation & Tracking Emails", () => {
    it("should schedule an order confirmation email to customerEmail on confirmed order", async () => {
      const quoteRes = await request(app)
        .post("/api/v1/quotes")
        .send({
          widthInches: 2.0,
          heightInches: 2.0,
          quantity: 5,
          material: "vinyl_matte"
        });

      const quote = quoteRes.body;
      const paymentProof = Buffer.from(JSON.stringify({
        status: "PAID",
        amount: quote.total_usd,
        paymentId: "tx-test-email-" + Date.now(),
        rail: "base_usdc"
      })).toString("base64");

      const res = await request(app)
        .post("/api/v1/orders")
        .set("authorization-x402", paymentProof)
        .send({
          quoteId: quote.quote_id,
          amount: quote.total_usd,
          artwork: TINY_PNG_DATA_URI,
          shippingAddress: {
            name: "Alice Designer",
            email: "alice@example.com",
            street: "456 Market St",
            city: "San Francisco",
            state: "CA",
            zip: "94105"
          }
        });

      expect(res.status).toBe(201);
      expect(scheduleEmailMock).toHaveBeenCalledTimes(1);

      const emailCall = scheduledEmails.find(e => e.jobName === "order-confirmation");
      expect(emailCall).toBeDefined();
      expect(emailCall.data.to).toBe("alice@example.com");
      expect(emailCall.data.subject).toContain("Order Confirmed!");
      expect(emailCall.data.subject).toContain(res.body.orderId);
      expect(emailCall.data.text).toContain("Alice");
      expect(emailCall.data.html).toContain("Alice");
      expect(emailCall.data.html).toContain("https://splotch.page/orders.html?id=" + res.body.orderId);
    });
  });

  describe("Agent Webhooks (dispatchOrderWebhook)", () => {
    it("should silently ignore invalid or non-http webhook URLs without crashing", async () => {
      const order = { orderId: "ord_test_invalid", webhookUrl: "not-a-url" };
      const dispatched = await dispatchOrderWebhook(order, "order.created");
      expect(dispatched).toBe(false);
    });

    it("should post event payload to valid webhook endpoint", async () => {
      const order = {
        orderId: "ord_test_live",
        webhookUrl: "https://httpbin.org/post",
        status: "SHIPPED",
        trackingNumber: "9400111899223344556677",
        amountUsd: 15.50,
        orderDetails: {
          quantity: 25,
          material: "vinyl_matte",
          widthInches: 2.0,
          heightInches: 2.0
        }
      };

      // Mock fetch
      const originalFetch = global.fetch;
      let postedBody = null;
      let postedHeaders = null;

      global.fetch = jest.fn(async (url, opts) => {
        postedBody = JSON.parse(opts.body);
        postedHeaders = opts.headers;
        return { ok: true, status: 200 };
      });

      try {
        const success = await dispatchOrderWebhook(order, "order.shipped", { courier: "USPS" });
        expect(success).toBe(true);
        expect(postedBody.event).toBe("order.shipped");
        expect(postedBody.orderId).toBe("ord_test_live");
        expect(postedBody.trackingNumber).toBe("9400111899223344556677");
        expect(postedBody.courier).toBe("USPS");
        expect(postedBody.trackingUrl).toBe("https://splotch.page/orders.html?id=ord_test_live");
        expect(postedHeaders["User-Agent"]).toContain("Splotch-Agent-Webhook");
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
