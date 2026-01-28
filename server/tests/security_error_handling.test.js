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

describe('Security: Error Handling and Information Leakage', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-error-handling.json');
  const dummyFilePath = path.join(__dirname, '../uploads/dummy_error_test.png');

  // A mock Square client that throws a generic Error (not a SquareError)
  // This simulates an unexpected internal error (e.g. network crash, bug in SDK wrapper, etc.)
  const mockSquareClient = {
    locations: {},
    payments: {
      create: jest.fn().mockImplementation(() => {
        throw new Error('CRITICAL_DATABASE_CONNECTION_STRING_LEAKED');
      })
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

  it('should NOT leak internal error details in 500 responses', async () => {
    const agent = request.agent(app);

    // 1. Get CSRF Token
    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // 2. Register/Login
    await agent.post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'tester', password: 'password123' });

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    const loginRes = await agent.post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'tester', password: 'password123' });

    const authToken = loginRes.body.token;

    // 3. Create Order
    const payload = {
      sourceId: 'cnon:card-nonce-ok',
      amountCents: 100, // Matches our mock pricing
      currency: 'USD',
      designImagePath: '/uploads/dummy_error_test.png',
      orderDetails: { quantity: 1 },
      shippingContact: {
        givenName: 'Test',
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

    // Expect 500 because we threw an error
    expect(res.statusCode).toEqual(500);

    // SECURITY ASSERTION: The response should NOT contain the sensitive error message
    // CURRENT BEHAVIOR (Vulnerable): Returns { error: 'Internal Server Error', message: 'CRITICAL_DATABASE_CONNECTION_STRING_LEAKED' }
    // EXPECTED BEHAVIOR (Secure): Returns { error: 'Internal Server Error', message: 'An unexpected error occurred.' }

    if (res.body.message === 'An unexpected error occurred.') {
        console.log("Success: Sensitive error message suppressed.");
    } else {
        console.log("Failure: Error message might be leaked:", res.body.message);
    }

    expect(res.body.message).toEqual('An unexpected error occurred.');
  });
});
