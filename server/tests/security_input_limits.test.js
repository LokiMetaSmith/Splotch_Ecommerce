import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security: Input Limits in Create Order', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-input-limits.json');

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
        await fs.copyFile(path.join(__dirname, '../../favicon.png'), path.join(uploadsDir, 'test_limits.png'));
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
        await fs.unlink(path.join(__dirname, '../uploads/test_limits.png'));
    } catch (error) {
        // ignore
    }
  });

  it('should reject requests with excessively long input strings', async () => {
    const agent = request.agent(app);

    // 1. Get CSRF Token
    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // 2. Register/Login to get Token
    await agent
      .post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'tester', password: 'password123' });

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'tester', password: 'password123' });

    const authToken = loginRes.body.token;

    // 3. Create Order with excessively long givenName
    const longString = 'a'.repeat(10001); // 10k+ characters
    const payload = {
      sourceId: 'cnon:card-nonce-ok',
      amountCents: 2, // Assuming 2 cents for favicon.png based on previous tests
      currency: 'USD',
      designImagePath: '/uploads/test_limits.png',
      orderDetails: { quantity: 10 },
      shippingContact: {
        givenName: 'ValidName',
        addressLines: ['123 Valid St'],
        locality: 'Valid Town',
        administrativeDistrictLevel1: 'CA',
        postalCode: '90210',
        country: 'US'
      },
      billingContact: {
        givenName: longString, // ATTACK HERE
        familyName: 'Doe',
        email: 'tester@example.com',
      }
    };

    const res = await agent
      .post('/api/create-order')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send(payload);

    // Expect 400 Bad Request due to validation error
    expect(res.statusCode).toEqual(400);
    expect(res.body.errors).toBeDefined();
    // We expect express-validator to complain about the field
    const nameError = res.body.errors.find(e => e.path === 'billingContact.givenName');
    // Note: Since we haven't implemented the custom message for length yet,
    // we just check that an error exists for this field.
    // When we implement it, we can check for "Invalid characters" or specific length message.
    // But wait, the current code checks for '<'.
    // 'a'.repeat(10001) does NOT contain '<'.
    // So if the length limit is NOT implemented, this request SHOULD SUCCEED (201).
    // If we want this test to PASS when limits ARE implemented, we assert 400.
    // Right now, before the fix, this test should FAIL (receive 201).
  });
});
