import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Splotch MCP Server
export const mcpServer = new Server(
  { name: "splotch-ecommerce-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const activeTransports = new Map();

export const mcpRequestHandler = async (req, res) => {
  const sseTransport = new SSEServerTransport("/api/mcp/messages", res);
  await mcpServer.connect(sseTransport);
  activeTransports.set(sseTransport.sessionId, sseTransport);

  res.on("close", () => {
    activeTransports.delete(sseTransport.sessionId);
  });
};

export const mcpMessageHandler = async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = activeTransports.get(sessionId);

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).send("Session not found or MCP Server not connected");
  }
};

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
          required: ["quoteId", "designUrl", "shippingAddress"]
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
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            quoteId: `quote_${Date.now()}`,
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
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            orderIntentId: `ord_${Date.now()}`,
            paymentStatus: "REQUIRES_PAYMENT",
            x402Challenge: {
              version: "x402/1.0",
              paymentEndpoint: "https://api.splotch.shop/v1/payments/ap2",
              amount: args.amount || "15.00",
              currency: "USD"
            }
          })
        }
      ]
    };
  }

  throw new Error(`Tool not found: ${name}`);
});

// Optionally connect to stdio transport for local CLI runners
if (process.env.MCP_STDIO === "true") {
  const transport = new StdioServerTransport();
  mcpServer.connect(transport).catch(console.error);
}
