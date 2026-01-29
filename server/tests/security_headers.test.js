import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security: HTTP Headers', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-headers.json');

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
    const data = { orders: {}, users: {}, credentials: {}, config: {}, products: {} };
    db = {
      data: data,
      write: async () => { },
      read: async () => { }
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

  it('should have correct security headers on /api/ping', async () => {
    const res = await request(app).get('/api/ping');

    expect(res.statusCode).toEqual(200);

    // X-Content-Type-Options should be set by lusca
    expect(res.headers['x-content-type-options']).toEqual('nosniff');

    // Permissions-Policy (Feature-Policy)
    expect(res.headers['permissions-policy']).toEqual('geolocation=(), microphone=(), camera=()');

    // Referrer-Policy
    expect(res.headers['referrer-policy']).toEqual('strict-origin-when-cross-origin');
  });
});
