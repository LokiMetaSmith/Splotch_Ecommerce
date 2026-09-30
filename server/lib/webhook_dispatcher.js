/**
 * Dispatches event notifications to an agent's registered webhook URL.
 *
 * @param {object} order - Splotch order record
 * @param {string} event - Event name e.g. "order.created", "order.status_updated", "order.shipped"
 * @param {object} extraData - Additional event-specific metadata
 * @returns {Promise<boolean>}
 */
export async function dispatchOrderWebhook(order, event, extraData = {}) {
  const webhookUrl = order.webhookUrl || order.webhook_url;
  if (!webhookUrl || typeof webhookUrl !== "string" || !webhookUrl.startsWith("http")) {
    return false;
  }

  const payload = {
    event,
    timestamp: new Date().toISOString(),
    orderId: order.orderId,
    status: order.status,
    trackingNumber: order.trackingNumber || order.tracking_number || null,
    trackingUrl: `https://splotch.page/orders.html?id=${order.orderId}`,
    fulfillmentTrackingUrl: `https://splotch.page/api/v1/orders/${order.orderId}`,
    amountUsd: order.amountUsd !== undefined ? order.amountUsd : (order.amount ? (order.amount / 100).toFixed(2) : null),
    quantity: order.quantity || order.orderDetails?.quantity || 1,
    material: order.material || order.orderDetails?.material || "vinyl_matte",
    cutType: order.cutType || order.orderDetails?.cutType || "die_cut",
    dimensions: {
      widthInches: order.widthInches || order.orderDetails?.widthInches || null,
      heightInches: order.heightInches || order.orderDetails?.heightInches || null,
    },
    ...extraData
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Splotch-Agent-Webhook/1.0 (+https://splotch.page)"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[WEBHOOK] Failed to dispatch ${event} to ${webhookUrl}: ${err.message}`);
    return false;
  }
}
