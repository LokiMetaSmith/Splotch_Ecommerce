import { startServer } from './server.js';
import { JSONFilePreset } from 'lowdb/node';
import { LowDbAdapter } from './database/lowdb_adapter.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock Square Client
const mockSquareClient = {
  locations: {}, // needed for sanity check
  payments: {
    create: async (payload) => {
      console.log('[TEST-SERVER] Mock Square Payment Created:', payload);
      return {
        payment: {
          id: 'mock-payment-id-' + Date.now(),
          orderId: 'mock-square-order-id-' + Date.now(),
          status: 'COMPLETED',
          amountMoney: payload.amountMoney,
        }
      };
    }
  }
};

async function main() {
    const dbPath = path.join(__dirname, 'db.test.json');

    // Ensure clean DB for test run?
    // Ideally we want a fresh DB for each test run, but since the server stays up, we might just reuse it.
    // Tests should be robust enough to handle existing data.

    const lowDbInstance = await JSONFilePreset(dbPath, { orders: {}, users: {}, credentials: {}, config: {} });
    const db = new LowDbAdapter(lowDbInstance);

    // Pass mockSquareClient
    // db, bot, sendEmail, dbPath, injectedSquareClient
    const { app } = await startServer(db, null, undefined, dbPath, mockSquareClient);

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`[TEST-SERVER] Listening on ${port}`);
    });
}

main();
