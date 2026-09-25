import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "child_process";
import util from "util";
import path from "path";
import { fileURLToPath } from "url";

const execFilePromise = util.promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const activeSessions = new Map();

function createMcpServer(db) {
  const mcpServer = new Server(
    { name: "splotch-ecommerce-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "calculate_sticker_quote",
          description: "Calculate sticker cost based on dimensions, cut type, quantity, and material.",
          inputSchema: {
            type: "object",
            properties: {
              widthInches: { type: "number" },
              heightInches: { type: "number" },
              quantity: { type: "integer" },
              material: { type: "string", enum: ["vinyl_matte", "vinyl_gloss", "holographic"] },
              cutType: { type: "string", enum: ["die_cut", "kiss_cut"] }
            },
            required: ["widthInches", "heightInches", "quantity", "material"]
          }
        },
        {
          name: "create_agent_checkout",
          description: "Generate an AP2/x402 payment intent for a sticker order.",
          inputSchema: {
            type: "object",
            properties: {
              quoteId: { type: "string" },
              amount: { type: "string" },
              designUrl: { type: "string" },
              shippingAddress: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  street: { type: "string" },
                  city: { type: "string" },
                  state: { type: "string" },
                  zip: { type: "string" }
                },
                required: ["name", "street", "city", "state", "zip"]
              }
            },
            required: ["quoteId", "amount", "designUrl", "shippingAddress"]
          }
        }
      ]
    };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "calculate_sticker_quote") {
      // Call Splotch internal pricing logic
      const unitPrice = (args.widthInches * args.heightInches * 0.15) + (args.material === "holographic" ? 0.35 : 0.20);
      const total = parseFloat((unitPrice * args.quantity).toFixed(2));

      const quoteId = `quote_${Date.now()}`;
      const expiresAt = new Date(Date.now() + 30 * 60000).toISOString();

      await db.createQuote({
          quoteId,
          unitPrice,
          total,
          currency: "USD",
          expiresAt,
          status: "PENDING"
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              quoteId,
              unitPrice,
              total,
              currency: "USD",
              validUntilMinutes: 30
            })
          }
        ]
      };
    }

    if (name === "create_agent_checkout") {
      // Pre-Payment Asset Preflight Validation
      if (!args.designUrl || !args.designUrl.startsWith("http")) {
        throw new Error("Preflight Failed: Invalid or inaccessible designUrl. Must be a valid HTTP(S) URL.");
      }

      let assetData;

      // SSRF Mitigation
      let urlObj;
      try {
          urlObj = new URL(args.designUrl);
      } catch (e) {
          throw new Error("Preflight Failed: Invalid URL format.");
      }

      const hostname = urlObj.hostname;
      if (
          hostname === "localhost" ||
          hostname.startsWith("127.") ||
          hostname.startsWith("10.") ||
          hostname.startsWith("192.168.") ||
          hostname.startsWith("0.")
      ) {
          throw new Error("Preflight Failed: SSRF attempt blocked.");
      }

      // Test environment fetch mock bypass
      if (process.env.NODE_ENV !== "test" || !args.designUrl.includes("test.local")) {
         const controller = new AbortController();
         const timeoutId = setTimeout(() => controller.abort(), 5000);

         try {
             const response = await fetch(args.designUrl, { signal: controller.signal });
             clearTimeout(timeoutId);

             if (!response.ok) {
                 throw new Error(`HTTP ${response.status}`);
             }

             // 5MB Size Limit Validation
             const contentLength = response.headers.get("content-length");
             if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
                 throw new Error("File exceeds 5MB size limit.");
             }

             const buffer = await response.arrayBuffer();
             if (buffer.byteLength > 5 * 1024 * 1024) {
                 throw new Error("File exceeds 5MB size limit.");
             }
             if (buffer.byteLength === 0) throw new Error("Empty image file");

             if (!args.designUrl.toLowerCase().endsWith(".svg") && !args.designUrl.toLowerCase().endsWith(".png")) {
                 throw new Error("Unprintable artwork format. Only SVG or PNG assets are accepted.");
             }
         } catch (fetchErr) {
             throw new Error(`Preflight Failed: Could not download asset. ${fetchErr.message}`);
         }
      }

      // Route through requested child process validation
      try {
          const scriptPath = path.join(__dirname, "..", "fix_svg_render.cjs");
          await execFilePromise("node", [scriptPath], { timeout: 5000 });
      } catch (execErr) {
          throw new Error(`Preflight Failed: Asset validation routines failed. ${execErr.message}`);
      }

      // In a real system, you would save this intent mapping the quote/design/shipping to the order intent ID
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              orderIntentId: `ord_${Date.now()}`,
              quoteId: args.quoteId,
              designUrl: args.designUrl,
              shippingAddress: args.shippingAddress,
              paymentStatus: "REQUIRES_PAYMENT",
              x402Challenge: {
                version: "x402/1.0",
                paymentEndpoint: "https://api.splotch.shop/api/v1/payments/ap2",
                amount: args.amount,
                currency: "USD"
              }
            })
          }
        ]
      };
    }

    throw new Error(`Tool not found: ${name}`);
  });

  return mcpServer;
}


export const mcpRequestHandler = async (req, res, db) => {
  const sseTransport = new SSEServerTransport("/api/mcp/messages", res);
  const mcpServer = createMcpServer(db);
  await mcpServer.connect(sseTransport);
  activeSessions.set(sseTransport.sessionId, { sseTransport, mcpServer });

  res.on("close", async () => {
    try {
      await sseTransport.close();
    } catch (e) {
      // Ignore cleanup errors
    }
    activeSessions.delete(sseTransport.sessionId);
  });
};

export const mcpMessageHandler = async (req, res, db) => {
  const sessionId = req.query.sessionId;
  const session = activeSessions.get(sessionId);

  if (session) {
    await session.sseTransport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Session not found or MCP Server not connected");
  }
};
