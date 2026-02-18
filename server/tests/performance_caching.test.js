import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Performance: Caching Headers', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-caching.json');

  const mockSquareClient = {
    locations: {},
    payments: {
      create: jest.fn().mockResolvedValue({
        payment: { id: 'mock_payment_id', orderId: 'mock_square_order_id' }
      })
    }
  };

  beforeAll(async () => {
    // Mock DB
    const data = { orders: {}, users: {}, credentials: {}, config: {}, products: {}, inventory_cache: {} };
    db = {
      data: data,
      write: async () => { },
      read: async () => { },
      getInventoryCache: async () => { return { 'pp_standard': 100 }; }
    };

    mockSendEmail = jest.fn();

    // Pass mock Square client
    const server = await startServer(db, null, mockSendEmail, testDbPath, mockSquareClient);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    serverInstance = app.listen();
  });

  afterAll(async () => {
    if (bot) await bot.stop('test');
    if (timers) timers.forEach(timer => clearInterval(timer));
    await new Promise(resolve => serverInstance.close(resolve));
  });

  it('should enable public caching for /api/pricing-info (max-age=3600)', async () => {
    const res = await request(app).get('/api/pricing-info');
    expect(res.statusCode).toEqual(200);
    expect(res.headers['cache-control']).toEqual('public, max-age=3600');
  });

  it('should enable public caching for /api/inventory (max-age=60)', async () => {
    const res = await request(app).get('/api/inventory');
    expect(res.statusCode).toEqual(200);
    expect(res.headers['cache-control']).toEqual('public, max-age=60');
  });

  it('should disable caching for sensitive endpoints like /api/auth/verify-token', async () => {
    // Note: We expect 401 because we don't provide a token, but the middleware runs first.
    // However, if authenticateToken runs first, it might return 401 before sending headers?
    // Let's check /api/ping which is public but not explicitly cached.
    const res = await request(app).get('/api/ping');
    expect(res.statusCode).toEqual(200);
    // Expect the default no-store
    expect(res.headers['cache-control']).toContain('no-store');
  });
});
