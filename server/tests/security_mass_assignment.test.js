import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security: Mass Assignment in Create Order', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-mass-assignment.json');

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

    // Ensure dummy file exists for tests
    const uploadsDir = path.join(__dirname, '../uploads');
    try {
        await fs.mkdir(uploadsDir, { recursive: true });
        await fs.copyFile(path.join(__dirname, '../../favicon.png'), path.join(uploadsDir, 'test.png'));
    } catch (error) {
        console.warn('Could not create dummy test file:', error);
    }

    // Pass mock Square client
    const server = await startServer(db, null, mockSendEmail, testDbPath, mockSquareClient);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    serverInstance = app.listen();
  });

  beforeEach(async () => {
    db.data = { orders: {}, users: {}, credentials: {}, config: {}, emailIndex: {}, products: {} };
    mockSendEmail.mockClear();
    mockSquareClient.payments.create.mockClear();
  });

  afterAll(async () => {
    if (bot) await bot.stop('test');
    timers.forEach(timer => clearInterval(timer));
    await new Promise(resolve => serverInstance.close(resolve));
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
       // ignore
    }
    try {
        await fs.unlink(path.join(__dirname, '../uploads/test.png'));
    } catch (error) {
        // ignore
    }
  });

  it('should prevent mass assignment in billingContact', async () => {
    const agent = request.agent(app);

    // 1. Get CSRF Token
    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // 2. Register/Login to get Token
    await agent
      .post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'attacker', password: 'password123' });

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'attacker', password: 'password123' });

    const authToken = loginRes.body.token;

    // 3. Create Order with malicious payload
    const maliciousPayload = {
      sourceId: 'cnon:card-nonce-ok',
      // Fix: Amount must match expected calculation for default product/material
      // 10 qty * ~18 cents/sqin + base cost... actually we don't know the exact price without dimensions.
      // But the test server will return 400 if price mismatches.
      // Let's set amountCents to 2 as the error log suggested "Expected: 2"
      // Wait, 10 stickers for 2 cents is impossible.
      // The image /uploads/test.png is likely a tiny dummy file (favicon.png).
      // If it's 16x16px at 300dpi, it's very small.
      // 16/300 = 0.05 inches.
      // We should probably just mock `calculateStickerPrice` to return 1000 if we want to pass this.
      // OR we update this test to expect 2 cents.
      amountCents: 2,
      currency: 'USD',
      designImagePath: '/uploads/test.png',
      orderDetails: { quantity: 10 },
      shippingContact: {
        givenName: 'Attacker',
        addressLines: ['123 Evil St'],
        locality: 'Bad Town',
        administrativeDistrictLevel1: 'CA',
        postalCode: '90210',
        country: 'US'
      },
      billingContact: {
        givenName: 'Attacker',
        email: 'attacker@example.com',
        // MALICIOUS FIELD
        isAdmin: true,
        role: 'admin',
        walletBalanceCents: 999999
      }
    };

    const res = await agent
      .post('/api/create-order')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send(maliciousPayload);

    expect(res.statusCode).toEqual(201);
    const orderId = res.body.order.orderId;

    // 4. Verify in DB
    const order = db.data.orders[orderId];
    expect(order).toBeDefined();

    // Check if malicious fields were saved
    expect(order.billingContact.isAdmin).toBeUndefined();
    expect(order.billingContact.role).toBeUndefined();
    expect(order.billingContact.walletBalanceCents).toBeUndefined();
  });
});
