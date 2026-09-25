import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { JSDOM } from "jsdom";
import { SVGParser } from "../src/lib/svgparser.js";

// Polyfill DOMParser for SVGParser in Node environment
global.DOMParser = new JSDOM().window.DOMParser;
global.document = new JSDOM().window.document;

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

      // Test environment fetch mock bypass
      if (process.env.NODE_ENV === "test" && args.designUrl.includes("test.local")) {
         if (args.designUrl.includes("invalid")) {
             assetData = "invalid-svg-content";
         } else {
             assetData = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
         }
      } else {
         try {
             const response = await fetch(args.designUrl);
             if (!response.ok) {
                 throw new Error(`HTTP ${response.status}`);
             }
             if (args.designUrl.toLowerCase().endsWith(".svg")) {
                 assetData = await response.text();
             } else if (args.designUrl.toLowerCase().endsWith(".png")) {
                 const buffer = await response.arrayBuffer();
                 if (buffer.byteLength === 0) throw new Error("Empty image file");
                 assetData = "png-valid"; // Skip deep parse for png in this proof of concept
             } else {
                 throw new Error("Unprintable artwork format. Only SVG or PNG assets are accepted.");
             }
         } catch (fetchErr) {
             throw new Error(`Preflight Failed: Could not download asset. ${fetchErr.message}`);
         }
      }

      if (args.designUrl.toLowerCase().endsWith(".svg")) {
          try {
              const parser = new SVGParser();
              parser.load(assetData);
          } catch (svgErr) {
              throw new Error(`Preflight Failed: Unparseable SVG artwork. ${svgErr.message}`);
          }
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
