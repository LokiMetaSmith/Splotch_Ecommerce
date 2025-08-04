import { startServer } from './server.js';
import { initializeBot } from './bot.js';

async function main() {
  const { app, db } = await startServer();
  const bot = initializeBot(db);

  const port = process.env.PORT || 3000;

  const server = app.listen(port, () => {
    console.log(`[SERVER] Server listening at http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ [FATAL] Port ${port} is already in use.`);
      console.error('Please close the other process or specify a different port in your .env file.');
      process.exit(1);
    } else {
      console.error(`❌ [FATAL] An unexpected error occurred:`, error);
      process.exit(1);
    }
  });

  // Check for stalled orders every hour
  setInterval(async () => {
    const now = new Date();
    const stalledOrders = db.data.orders.filter(order => {
      if (order.status === 'SHIPPED' || order.status === 'CANCELED') {
        return false;
      }
      const lastUpdatedAt = new Date(order.lastUpdatedAt || order.receivedAt);
      const hoursSinceUpdate = (now - lastUpdatedAt) / 1000 / 60 / 60;
      return hoursSinceUpdate > 4;
    });

    for (const order of stalledOrders) {
      const message = `
  ⚠️ Order Stalled: ${order.orderId}
  Status: ${order.status}
  Last Update: ${new Date(order.lastUpdatedAt || order.receivedAt).toLocaleString()}
      `;
      try {
        await bot.sendMessage(process.env.TELEGRAM_CHANNEL_ID, message, {
          reply_to_message_id: order.telegramMessageId,
        });
      } catch (error) {
        console.error('[TELEGRAM] Failed to send stalled order notification:', error);
      }
    }
  }, 1000 * 60 * 60);
}

main();
