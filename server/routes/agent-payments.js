import express from "express";
const router = express.Router();

router.post("/v1/agent/orders", async (req, res) => {
  const paymentProof = req.headers["authorization-x402"];
  const ap2Mandate = req.headers["x-ap2-mandate"];

  if (!paymentProof || !ap2Mandate) {
    // Return standard HTTP 402 challenge, requesting both x402 payment proof and AP2 mandate
    return res.status(402).json({
      error: "Payment Required",
      protocol: "x402",
      ap2_support: true,
      quote: {
        amount: req.body.amount || "15.00",
        currency: "USD",
        recipient: "splotch-creative-settlement",
        settlement_methods: ["lightning", "base_usdc"]
      },
      instructions: "Include authorization header 'authorization-x402' for payment proof and 'x-ap2-mandate' for the signed AP2 Cart Mandate."
    });
  }

  // Mock Validate AP2 mandate token / settlement
  // Real implementation would verify the cryptographic signature of ap2Mandate
  // and validate the x402 payment token
  const verified = {
      success: true,
      mandateId: "mock-mandate-" + Date.now(),
      paymentId: "mock-x402-payment-" + Date.now()
  };

  if (!verified.success) {
    return res.status(403).json({ error: "Invalid AP2 mandate or x402 payment proof" });
  }

  // Mock Enqueue print-shop job and record order
  const order = {
      id: "ord_" + Date.now()
  }; // await createOrderRecord({ buyerType: "agent", items: req.body.items, mandateId: verified.mandateId });

  return res.status(201).json({
    status: "CONFIRMED",
    orderId: order.id,
    trackingUrl: `https://splotch.shop/orders.html?id=${order.id}`
  });
});

export default router;
