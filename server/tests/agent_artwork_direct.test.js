import request from "supertest";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jest } from "@jest/globals";
import createAgentPaymentsRouter from "../routes/agent-payments.js";
import { downloadAgentArtwork, detectImageBufferType } from "../lib/artwork_downloader.js";
import { createMcpServer } from "../mcp.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, "../uploads");

// 1x1 Transparent PNG in Base64
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_BASE64}`;
const SIMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="purple"/></svg>`;

describe("Direct Agent Artwork Handling & Headless Uploads", () => {
  let app;
  let mockDb;
  let inMemoryQuotes;
  let inMemoryOrders;

  beforeEach(() => {
    inMemoryQuotes = new Map();
    inMemoryOrders = [];

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

    app = express();
    app.use(express.json({ limit: "25mb" }));
    app.use("/api", createAgentPaymentsRouter(mockDb));
  });

  describe("downloadAgentArtwork utility", () => {
    it("should accept a data:image/png;base64 URI and write to uploads", async () => {
      const savedPath = await downloadAgentArtwork(TINY_PNG_DATA_URI);
      expect(savedPath).toMatch(/^\/uploads\/designImage-agent-.+\.png$/);
      const absPath = path.join(UPLOADS_DIR, path.basename(savedPath));
      expect(fs.existsSync(absPath)).toBe(true);
    });

    it("should accept a raw Base64 PNG string without data: prefix", async () => {
      const savedPath = await downloadAgentArtwork(TINY_PNG_BASE64);
      expect(savedPath).toMatch(/^\/uploads\/designImage-agent-.+\.png$/);
      const absPath = path.join(UPLOADS_DIR, path.basename(savedPath));
      expect(fs.existsSync(absPath)).toBe(true);
    });

    it("should accept raw SVG XML markup and save as .svg", async () => {
      const savedPath = await downloadAgentArtwork(SIMPLE_SVG);
      expect(savedPath).toMatch(/^\/uploads\/designImage-agent-.+\.svg$/);
      const absPath = path.join(UPLOADS_DIR, path.basename(savedPath));
      expect(fs.existsSync(absPath)).toBe(true);
      const content = await fs.promises.readFile(absPath, "utf8");
      expect(content).toContain("<circle cx=\"50\"");
    });

    it("should preserve existing /uploads/ paths without re-downloading", async () => {
      const existing = "/uploads/designImage-agent-existing-1234.png";
      const result = await downloadAgentArtwork(existing);
      expect(result).toBe(existing);
    });

    it("should correctly detect image types via detectImageBufferType", () => {
      const pngBuf = Buffer.from(TINY_PNG_BASE64, "base64");
      expect(detectImageBufferType(pngBuf)?.ext).toBe(".png");

      const svgBuf = Buffer.from(SIMPLE_SVG, "utf8");
      expect(detectImageBufferType(svgBuf)?.ext).toBe(".svg");
    });
  });

  describe("POST /api/v1/upload (Headless Upload Endpoint)", () => {
    it("should accept JSON with Base64 artwork and return hosted designUrl", async () => {
      const res = await request(app)
        .post("/api/v1/upload")
        .send({ artwork: TINY_PNG_DATA_URI });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.designUrl).toMatch(/^\/uploads\/designImage-agent-.+\.png$/);
      expect(res.body.url).toContain("https://splotch.page/uploads/");
    });

    it("should accept JSON with raw SVG markup and return hosted designUrl", async () => {
      const res = await request(app)
        .post("/api/v1/upload")
        .send({ artwork: SIMPLE_SVG });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.designUrl).toMatch(/^\/uploads\/designImage-agent-.+\.svg$/);
    });

    it("should accept raw binary PNG bytes with Content-Type: image/png", async () => {
      const pngBuffer = Buffer.from(TINY_PNG_BASE64, "base64");
      const res = await request(app)
        .post("/api/v1/upload")
        .set("Content-Type", "image/png")
        .send(pngBuffer);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.designUrl).toMatch(/^\/uploads\/designImage-agent-.+\.png$/);
      expect(res.body.sizeBytes).toBe(pngBuffer.length);
    });

    it("should reject upload if artwork is missing", async () => {
      const res = await request(app)
        .post("/api/v1/upload")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Missing artwork");
    });
  });

  describe("POST /api/v1/orders with direct artwork", () => {
    let quoteId;

    beforeEach(async () => {
      const quoteRes = await request(app)
        .post("/api/v1/quotes")
        .send({ widthInches: 2, heightInches: 2, quantity: 1 });
      quoteId = quoteRes.body.quoteId;
    });

    it("should confirm order when designUrl is a Base64 data URI", async () => {
      const storedQuote = inMemoryQuotes.get(quoteId);
      const res = await request(app)
        .post("/api/v1/orders")
        .send({
          quoteId,
          amount: storedQuote.total.toFixed(2),
          designUrl: TINY_PNG_DATA_URI,
          shippingAddress: {
            name: "Hermes Agent",
            email: "agent-hermes@example.com",
            street: "4200 W Pittsburg St",
            city: "Broken Arrow",
            state: "OK",
            zip: "74012"
          },
          settlement: {
            rail: "base_usdc",
            amount: storedQuote.total.toFixed(2),
            tx_hash: "0x" + "a".repeat(64),
            payer: "0x" + "1".repeat(40)
          }
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("CONFIRMED");
      expect(mockDb.createOrder).toHaveBeenCalled();
      const created = mockDb.createOrder.mock.calls[0][0];
      expect(created.designImagePath).toMatch(/^\/uploads\/designImage-agent-.+\.png$/);
    });

    it("should confirm order when artwork is passed as direct raw SVG in body.artwork", async () => {
      const storedQuote = inMemoryQuotes.get(quoteId);
      const res = await request(app)
        .post("/api/v1/orders")
        .send({
          quoteId,
          amount: storedQuote.total.toFixed(2),
          artwork: SIMPLE_SVG,
          shippingAddress: {
            name: "Hermes Agent",
            email: "agent-hermes@example.com",
            street: "4200 W Pittsburg St",
            city: "Broken Arrow",
            state: "OK",
            zip: "74012"
          },
          settlement: {
            rail: "base_usdc",
            amount: storedQuote.total.toFixed(2),
            tx_hash: "0x" + "b".repeat(64),
            payer: "0x" + "2".repeat(40)
          }
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("CONFIRMED");
      const created = mockDb.createOrder.mock.calls[0][0];
      expect(created.designImagePath).toMatch(/^\/uploads\/designImage-agent-.+\.svg$/);
    });
  });

  describe("MCP Tool Preflight with Direct Artwork", () => {
    let mcpServer;
    let callHandler;

    beforeEach(() => {
      mcpServer = createMcpServer(mockDb);
      callHandler = mcpServer._requestHandlers.get("tools/call");
    });

    it("should preflight successfully when designUrl is a Base64 data URI", async () => {
      const res = await callHandler(
        {
          method: "tools/call",
          params: {
            name: "place_order",
            arguments: {
              quoteId: "quo_test",
              amount: "1.50",
              designUrl: TINY_PNG_DATA_URI,
              shippingAddress: {
                name: "Test Agent",
                email: "agent@test.com",
                street: "123 Main",
                city: "Tulsa",
                state: "OK",
                zip: "74103"
              }
            }
          }
        },
        {}
      );

      expect(res).toBeDefined();
      expect(res.content).toBeDefined();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.paymentStatus).toBe("REQUIRES_PAYMENT");
      expect(parsed.orderIntentId).toMatch(/^ord_/);
    });

    it("should preflight successfully when designUrl is raw SVG markup", async () => {
      const res = await callHandler(
        {
          method: "tools/call",
          params: {
            name: "place_order",
            arguments: {
              quoteId: "quo_test",
              amount: "1.50",
              designUrl: SIMPLE_SVG,
              shippingAddress: {
                name: "Test Agent",
                email: "agent@test.com",
                street: "123 Main",
                city: "Tulsa",
                state: "OK",
                zip: "74103"
              }
            }
          }
        },
        {}
      );

      expect(res).toBeDefined();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.paymentStatus).toBe("REQUIRES_PAYMENT");
    });
  });
});
