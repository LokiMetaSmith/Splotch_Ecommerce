import logger from './logger.js';

// --- Global Error Handlers ---
process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ [FATAL] Unhandled Rejection at:', { promise, reason });
  // Optional: exit process, but it's often better to log and monitor
  // process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('❌ [FATAL] Uncaught Exception:', error);
  // It's generally recommended to exit after an uncaught exception
  process.exit(1);
});
// -----------------------------

import { startServer, FINAL_STATUSES } from './server.js';
import { initializeBot } from './bot.js';
import { sendEmail } from './email.js';
import { getSecret } from './secretManager.js';
import { JSONFilePreset } from 'lowdb/node';
import { Low } from 'lowdb';
import { getDatabaseAdapter } from './database/index.js';
import { EncryptedJSONFile } from './database/EncryptedJSONFile.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { encrypt, decrypt } from './encryption.js';

// Re-export for backward compatibility with tests
export { encrypt, decrypt };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    let db;

    if (getSecret('DB_PROVIDER') === 'mongo' || getSecret('MONGO_URL')) {
        const mongoUrl = getSecret('MONGO_URL');
        if (!mongoUrl) {
             logger.error('MONGO_URL must be set when DB_PROVIDER is mongo.');
             process.exit(1);
        }
        db = getDatabaseAdapter(mongoUrl);
        await db.connect();
        logger.info('[SERVER] Connected to MongoDB.');
    } else {
        const dbPath = path.join(__dirname, 'db.json');
        const defaultData = { orders: {}, users: {}, credentials: {}, config: {} };
        let lowDbInstance;

        if (getSecret('ENCRYPT_CLIENT_JSON') === 'true') {
            const adapter = new EncryptedJSONFile(dbPath);
            lowDbInstance = new Low(adapter, defaultData);
            await lowDbInstance.read();
            logger.info('[SERVER] Using EncryptedJSONFile adapter for database.');
        } else {
            lowDbInstance = await JSONFilePreset(dbPath, defaultData);
        }

        db = getDatabaseAdapter(lowDbInstance);
    }

    const bot = initializeBot(db, { startPolling: process.env.ENABLE_BOT_POLLING !== 'false' });
    // startServer now returns the app and timers
    const { app } = await startServer(db, bot, sendEmail);

  if (process.env.ENABLE_WEB_SERVER !== 'false') {
      const port = getSecret('PORT') || 3000;

      const server = app.listen(port, () => {
        logger.info(`[SERVER] Server listening at http://localhost:${port}`);
      });

      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`❌ [FATAL] Port ${port} is already in use.`);
          logger.error('Please close the other process or specify a different port in your .env file.');
          process.exit(1);
        } else {
          logger.error(`❌ [FATAL] An unexpected error occurred:`, error);
          process.exit(1);
        }
      });
  } else {
      logger.info('[SERVER] Web server disabled by ENABLE_WEB_SERVER environment variable. Running in background worker mode.');
  }

  // Check for stalled orders every hour
  setInterval(async () => {
    const now = new Date();
    const ordersToCheck = await db.getActiveOrders();

    const stalledOrders = ordersToCheck.filter(order => {
      if (FINAL_STATUSES.includes(order.status)) {
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
        const sentMessage = await bot.telegram.sendMessage(getSecret('TELEGRAM_CHANNEL_ID'), message, {
          reply_to_message_id: order.telegramMessageId,
        });
        // Store the message ID so we can delete it later
        const orderInDb = await db.getOrder(order.orderId);
        if (orderInDb) {
            orderInDb.stalledMessageId = sentMessage.message_id;
            await db.updateOrder(orderInDb);
        }
      } catch (error) {
        logger.error('[TELEGRAM] Failed to send stalled order notification:', error);
      }
    }
  }, 1000 * 60 * 60);
}

if (process.argv[1] === __filename) {
    main();
}
