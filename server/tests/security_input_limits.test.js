import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

// Mock pricing.js BEFORE importing server
jest.unstable_mockModule('../pricing.js', () => ({
  calculateStickerPrice: jest.fn().mockReturnValue({ total: 100, complexityMultiplier: 1 }),
  getDesignDimensions: jest.fn().mockResolvedValue({ bounds: { width: 100, height: 100 }, cutline: [] }),
  calculatePerimeter: jest.fn().mockReturnValue(100),
}));

const { startServer } = await import('../server.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security: Input Length Limits (DoS Protection)', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-input-limits.json');
  const dummyFilePath = path.join(__dirname, '../uploads/dummy_limit_test.png');

  const mockSquareClient = {
    locations: {},
    payments: {
      create: jest.fn().mockResolvedValue({ payment: { id: 'mock_payment_id', orderId: 'mock_square_order_id' } })
    }
  };

  beforeAll(async () => {
    // Create dummy file for validation
    await fs.writeFile(dummyFilePath, 'fake image content');

    // Mock DB
    db = {
      data: { orders: {}, users: {}, credentials: {}, config: {}, products: {}, emailIndex: {} },
      write: async () => { },
      read: async () => { }
    };

    mockSendEmail = jest.fn();

    // Start server with mock dependencies
    const server = await startServer(db, null, mockSendEmail, testDbPath, mockSquareClient);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    serverInstance = app.listen();
  });

  afterAll(async () => {
    if (bot) await bot.stop('test');
    timers.forEach(timer => clearInterval(timer));
    await new Promise(resolve => serverInstance.close(resolve));

    // Cleanup
    try {
      await fs.unlink(testDbPath);
    } catch (e) {}
    try {
      await fs.unlink(dummyFilePath);
    } catch (e) {}
  });

  it('should reject requests with excessively long input fields', async () => {
    const agent = request.agent(app);

    // 1. Get CSRF Token
    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // 2. Register/Login
    await agent.post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'limittester', password: 'password123' });

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    const loginRes = await agent.post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'limittester', password: 'password123' });

    const authToken = loginRes.body.token;

    // 3. Create Order with MASSIVE payload
    const longString = 'a'.repeat(2000); // 2000 characters
    const payload = {
      sourceId: 'cnon:card-nonce-ok',
      amountCents: 100,
      currency: 'USD',
      designImagePath: '/uploads/dummy_limit_test.png',
      orderDetails: { quantity: 1 },
      shippingContact: {
        givenName: longString, // SHOULD FAIL (max 100)
        addressLines: ['123 Test St'],
        locality: 'Testville',
        administrativeDistrictLevel1: 'TS',
        postalCode: '12345',
        country: 'US'
      },
      billingContact: {
        givenName: 'Test',
        email: 'test@example.com'
      }
    };

    const res = await agent
      .post('/api/create-order')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send(payload);

    // Expect 400 Bad Request
    expect(res.statusCode).toEqual(400);

    // Verify specific error message
    const hasNameError = res.body.errors.some(e => e.msg === 'Shipping First Name is too long');
    expect(hasNameError).toBe(true);
  });
});
