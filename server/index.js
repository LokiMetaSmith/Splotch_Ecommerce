import { startServer } from './server.js';
import { initializeBot } from './bot.js';
import { sendEmail } from './email.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENCRYPTION_KEY = process.env.JWT_SECRET; // 32 bytes
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
    const dbPath = path.join(__dirname, 'db.json');
    let db;

    if (process.env.ENCRYPT_CLIENT_JSON === 'true') {
        if (fs.existsSync(dbPath)) {
            const encryptedData = fs.readFileSync(dbPath, 'utf8');
            const decryptedData = decrypt(encryptedData);
            fs.writeFileSync(dbPath, decryptedData);
        }
    }

    db = await JSONFilePreset(dbPath, { orders: [], users: {}, credentials: {}, config: {} });

    if (process.env.ENCRYPT_CLIENT_JSON === 'true') {
        const originalWrite = db.write;
        db.write = async function() {
            const data = JSON.stringify(this.data);
            const encryptedData = encrypt(data);
            fs.writeFileSync(dbPath, encryptedData);
        }
    }

    const bot = initializeBot(db);
    const { app } = await startServer(db, bot, sendEmail);

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
        const sentMessage = await bot.sendMessage(process.env.TELEGRAM_CHANNEL_ID, message, {
          reply_to_message_id: order.telegramMessageId,
        });
        // Store the message ID so we can delete it later
        const orderInDb = db.data.orders.find(o => o.orderId === order.orderId);
        if (orderInDb) {
            orderInDb.stalledMessageId = sentMessage.message_id;
            await db.write();
        }
      } catch (error) {
        console.error('[TELEGRAM] Failed to send stalled order notification:', error);
      }
    }
  }, 1000 * 60 * 60);
}

main();
