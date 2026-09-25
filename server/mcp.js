import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const activeSessions = new Map();
export const agentQuotes = new Map();

function createMcpServer() {
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

      agentQuotes.set(quoteId, {
          quoteId,
          unitPrice,
          total,
          currency: "USD",
          expiresAt
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


export const mcpRequestHandler = async (req, res) => {
  const sseTransport = new SSEServerTransport("/api/mcp/messages", res);
  const mcpServer = createMcpServer();
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

export const mcpMessageHandler = async (req, res) => {
  const sessionId = req.query.sessionId;
  const session = activeSessions.get(sessionId);

  if (session) {
    await session.sseTransport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Session not found or MCP Server not connected");
  }
};
