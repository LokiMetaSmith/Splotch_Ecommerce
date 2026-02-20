import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security Guest Access Bypass', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-guest.json');

  beforeAll(async () => {
    const data = { orders: {}, users: {}, credentials: {}, config: {}, emailIndex: {} };
    db = {
      data: data,
      write: async () => { },
      read: async () => { }
    };

    mockSendEmail = jest.fn();
    // We pass null for Square client to use default mock behavior or let it fail gracefully (auth doesn't use Square)
    const server = await startServer(db, null, mockSendEmail, testDbPath);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    serverInstance = app.listen();
  });

  beforeEach(async () => {
    // Reset DB data
    db.data = { orders: {}, users: {}, credentials: {}, config: {}, emailIndex: {} };

    // Create a victim user
    const victim = {
        id: 'victim-id',
        username: 'victim',
        email: 'victim@example.com',
        password: '$2b$10$e8ypvsBL/MxhtxIydLPU2eoLd4IVyOy0MhGvCRL3DC/xUpoznhhHi', // hash for 'password'
        credentials: []
    };
    db.data.users['victim-id'] = victim;
    db.data.emailIndex['victim@example.com'] = 'victim-id';

    // Create an order for the victim
    const order = {
        orderId: '550e8400-e29b-41d4-a716-446655440000',
        status: 'NEW',
        billingContact: {
            email: 'victim@example.com',
            givenName: 'Victim',
            familyName: 'User'
        },
        shippingContact: {
             givenName: 'Victim',
             familyName: 'User',
             addressLines: ['123 Main St'],
             locality: 'City',
             administrativeDistrictLevel1: 'State',
             postalCode: '12345',
             country: 'Country'
        },
        orderDetails: {
            quantity: 10
        },
        amount: 1000,
        currency: 'USD',
        receivedAt: new Date().toISOString()
    };
    db.data.orders['550e8400-e29b-41d4-a716-446655440000'] = order;

    mockSendEmail.mockClear();
  });

  afterAll(async () => {
    if (bot) {
      await bot.stop('test');
    }
    timers.forEach(timer => clearInterval(timer));
    await new Promise(resolve => serverInstance.close(resolve));
      try {
        await fs.unlink(testDbPath);
      } catch (error) {
          // ignore
      }
  });

  it('should PREVENT searching victim orders with guest token', async () => {
    const agent = request.agent(app);

    // Get CSRF Token
    const csrfRes = await agent.get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;

    // 1. Get Guest Token for Victim Email
    // Note: issue-temp-token expects email in body
    const resToken = await agent
        .post('/api/auth/issue-temp-token')
        .set('X-CSRF-Token', csrfToken)
        .send({ email: 'victim@example.com' });

    expect(resToken.statusCode).toEqual(200);
    const guestToken = resToken.body.token;
    expect(guestToken).toBeDefined();

    // 2. Search Orders using Guest Token
    const resSearch = await agent
        .get('/api/orders/search')
        .query({ q: '550e8400-e29b-41d4-a716-446655440000' })
        .set('Authorization', `Bearer ${guestToken}`);

    // Expect FORBIDDEN (403) confirming vulnerability is patched
    expect(resSearch.statusCode).toEqual(403);
    expect(resSearch.body.error).toContain('Forbidden');
  });

  it('should PREVENT viewing specific order details with guest token', async () => {
    const agent = request.agent(app);

    // Get CSRF Token
    const csrfRes = await agent.get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;

    // 1. Get Guest Token
    const resToken = await agent
        .post('/api/auth/issue-temp-token')
        .set('X-CSRF-Token', csrfToken)
        .send({ email: 'victim@example.com' });

    const guestToken = resToken.body.token;

    // 2. Get Order Details
    const resOrder = await agent
        .get('/api/orders/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', `Bearer ${guestToken}`);

    // Expect FORBIDDEN (403) confirming vulnerability is patched
    expect(resOrder.statusCode).toEqual(403);
    expect(resOrder.body.error).toContain('Forbidden');
  });
});
