import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security: Path Traversal in Create Order', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-traversal.json');

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
    timers.forEach(timer => clearInterval(timer));
    await new Promise(resolve => serverInstance.close(resolve));
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
       // ignore
    }
  });

  it('should block path traversal in orderDetails.cutLinePath', async () => {
    const agent = request.agent(app);

    // 1. Get CSRF Token
    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // 2. Register/Login to get Token
    await agent
      .post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'attacker_trav', password: 'password123' });

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'attacker_trav', password: 'password123' });

    const authToken = loginRes.body.token;

    // 3. Attempt Traversal
    const payload = {
      sourceId: 'cnon:card-nonce-ok',
      amountCents: 100,
      currency: 'USD',
      designImagePath: '/uploads/test.png',
      orderDetails: {
          quantity: 1,
          cutLinePath: '../favicon.png' // Traversal
      },
      billingContact: {
        givenName: 'Attacker',
        email: 'attacker@example.com'
      },
      shippingContact: {
        givenName: 'Attacker',
        addressLines: ['123 Evil St'],
        locality: 'Bad Town',
        administrativeDistrictLevel1: 'CA',
        postalCode: '90210',
        country: 'US'
      }
    };

    const res = await agent
      .post('/api/create-order')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send(payload);

    // Expect Validation Error (400)
    expect(res.statusCode).toEqual(400);
    expect(res.body.errors).toBeDefined();
    // Check for specific validation message
    const cutLineError = res.body.errors.find(e => e.path === 'orderDetails.cutLinePath');
    expect(cutLineError).toBeDefined();
    expect(cutLineError.msg).toMatch(/Path must start with \/uploads\//);
  });
});
