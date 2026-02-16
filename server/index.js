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
import { getDatabaseAdapter } from './database/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rawSecret = getSecret('JWT_SECRET');
let ENCRYPTION_KEY;

// Robust key derivation to prevent crashes and ensure 32-byte key length for AES-256
if (!rawSecret) {
    if (getSecret('ENCRYPT_CLIENT_JSON') === 'true') {
        logger.error('❌ [FATAL] JWT_SECRET is missing but ENCRYPT_CLIENT_JSON is true.');
        logger.error('   You must provide a JWT_SECRET to encrypt the database.');
        process.exit(1);
    }
    // If encryption is disabled, we set a dummy key to prevent crashes if the key is accessed inadvertently.
    // This key will not be used for encryption as the encrypt/decrypt functions are guarded by the flag.
    ENCRYPTION_KEY = crypto.createHash('sha256').update('unused-key-when-encryption-disabled').digest();
} else if (Buffer.byteLength(rawSecret) === 32) {
    // Backward compatibility: If exactly 32 bytes, use as-is (legacy behavior)
    ENCRYPTION_KEY = rawSecret;
} else {
    // Robustness: Hash arbitrary length secrets to exactly 32 bytes
    ENCRYPTION_KEY = crypto.createHash('sha256').update(String(rawSecret)).digest();
}

const IV_LENGTH = 16; // For AES, this is always 16

function encrypt(text) {
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    let textParts = text.split(':');
    let iv = Buffer.from(textParts.shift(), 'hex');
    let encryptedText = Buffer.from(textParts.join(':'), 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

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

        if (getSecret('ENCRYPT_CLIENT_JSON') === 'true') {
            if (fs.existsSync(dbPath)) {
                const encryptedData = fs.readFileSync(dbPath, 'utf8');
                const decryptedData = decrypt(encryptedData);
                fs.writeFileSync(dbPath, decryptedData);
            }
        }

        const lowDbInstance = await JSONFilePreset(dbPath, { orders: {}, users: {}, credentials: {}, config: {} });

        if (getSecret('ENCRYPT_CLIENT_JSON') === 'true') {
            const originalWrite = lowDbInstance.write;
            lowDbInstance.write = async function() {
                const data = JSON.stringify(this.data);
                const encryptedData = encrypt(data);
                const tempPath = `${dbPath}.tmp`;
                await fs.promises.writeFile(tempPath, encryptedData);
                await fs.promises.rename(tempPath, dbPath);
            }
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

main();
