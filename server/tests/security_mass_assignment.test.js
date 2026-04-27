
import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock pricing.js
jest.unstable_mockModule('../pricing.js', () => ({
    calculateStickerPrice: jest.fn().mockReturnValue({ total: 100, complexityMultiplier: 1 }),
    getDesignDimensions: jest.fn().mockResolvedValue({ bounds: { width: 100, height: 100 }, cutline: [] }),
    calculatePerimeter: jest.fn().mockReturnValue(100),
}));

// Dynamic import after mocking
const { startServer } = await import('../server.js');

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
    // serverInstance = app.listen(); // REMOVED
  });

  beforeEach(async () => {
    db.data = { orders: {}, users: {}, credentials: {}, config: {}, emailIndex: {}, products: {} };
    mockSendEmail.mockClear();
    mockSquareClient.payments.create.mockClear();
  });

  afterAll(async () => {
    if (typeof serverInstance !== "undefined" && serverInstance && typeof serverInstance.close === "function") { await new Promise(resolve => serverInstance.close(resolve)); }
    serverInstance = null;

    if (bot) await bot.stop('test');
    if (typeof server !== "undefined" && server.close) await server.close();

    if (typeof serverData !== "undefined" && serverData.close) await serverData.close();

    try {
      await fs.unlink(testDbPath);
    } catch (error) { // eslint-disable-line no-unused-vars
       // ignore
    }
    try {
        await fs.unlink(path.join(__dirname, '../uploads/test.png'));
    } catch (error) { // eslint-disable-line no-unused-vars
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

    // Refresh CSRF Token
    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    // 3. Create Order with malicious payload
    const maliciousPayload = {
      sourceId: 'cnon:card-nonce-ok',
      amountCents: 100, // Matches mocked total (100)
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

    if (res.statusCode !== 201) {
        console.log('Mass assignment test failed:', res.statusCode, res.body);
    }
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
