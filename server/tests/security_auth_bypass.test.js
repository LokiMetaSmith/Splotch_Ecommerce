import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security: Auth Bypass via Issue Temp Token', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-security-auth.json');
  const ADMIN_EMAIL = 'admin@example.com';
  const VICTIM_EMAIL = 'victim@example.com';

  beforeAll(async () => {
    // Set ADMIN_EMAIL env var
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    // Set other required env vars to avoid startup errors
    process.env.SESSION_SECRET = 'test-secret';
    process.env.CSRF_SECRET = '12345678901234567890123456789012';

    // Mock DB
    const data = {
        orders: [],
        users: {
            'admin': {
                username: 'admin',
                email: ADMIN_EMAIL,
                role: 'admin',
                password: 'hashedpassword'
            },
            'victim': {
                username: 'victim',
                email: VICTIM_EMAIL,
                password: 'hashedpassword'
            }
        },
        credentials: {},
        config: {}
    };
    db = {
      data: data,
      write: async () => { },
      read: async () => { },
      getUserByEmail: async (email) => Object.values(db.data.users).find(u => u.email === email),
      getUser: async (username) => Object.values(db.data.users).find(u => u.username === username),
      getUserOrders: async (email) => {
          // Return some dummy orders for victim
          if (email === VICTIM_EMAIL) {
              return [{ orderId: 'order-123', billingContact: { email: VICTIM_EMAIL } }];
          }
          return [];
      },
      getAllOrders: async () => [{ orderId: 'order-123' }],
      getConfig: async () => ({}),
    };

    mockSendEmail = jest.fn();
    const server = await startServer(db, null, mockSendEmail, testDbPath);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    serverInstance = app.listen();
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
        if (error.code !== 'ENOENT') throw error;
    }
    delete process.env.ADMIN_EMAIL;
  });

  it('should NOT allow escalating to admin privileges via temp token', async () => {
    const agent = request.agent(app);

    // 1. Get CSRF Token
    const csrfRes = await agent.get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;

    // 2. Request Temp Token for Admin Email
    const resToken = await agent
      .post('/api/auth/issue-temp-token')
      .set('X-CSRF-Token', csrfToken)
      .send({ email: ADMIN_EMAIL });

    expect(resToken.statusCode).toEqual(200);
    const token = resToken.body.token;
    expect(token).toBeDefined();

    // 3. Access Admin Endpoint
    const resAdmin = await agent
      .get('/api/orders')
      .set('Authorization', `Bearer ${token}`);

    // Expect 403 Forbidden
    expect(resAdmin.statusCode).toEqual(403);
  });

  it('should NOT allow viewing other users orders via temp token', async () => {
    const agent = request.agent(app);

    // 1. Get CSRF Token
    const csrfRes = await agent.get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;

    // 2. Request Temp Token for Victim Email
    const resToken = await agent
      .post('/api/auth/issue-temp-token')
      .set('X-CSRF-Token', csrfToken)
      .send({ email: VICTIM_EMAIL });

    expect(resToken.statusCode).toEqual(200);
    const token = resToken.body.token;
    expect(token).toBeDefined();

    // 3. Access Victim's Orders
    const resOrders = await agent
      .get('/api/orders/my-orders')
      .set('Authorization', `Bearer ${token}`);

    // Expect 403 Forbidden
    expect(resOrders.statusCode).toEqual(403);
  });

  it('should allow accessing create-order endpoint with temp token (expecting 400 due to invalid body)', async () => {
    const agent = request.agent(app);

    // 1. Get CSRF Token
    const csrfRes = await agent.get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;

    // 2. Request Temp Token
    const resToken = await agent
      .post('/api/auth/issue-temp-token')
      .set('X-CSRF-Token', csrfToken)
      .send({ email: 'guest@example.com' });

    const token = resToken.body.token;

    // 3. Call Create Order
    const resCreate = await agent
      .post('/api/create-order')
      .set('X-CSRF-Token', csrfToken)
      .set('Authorization', `Bearer ${token}`)
      .send({}); // Empty body

    // Expect 400 (Validation Error), NOT 403 (Forbidden)
    expect(resCreate.statusCode).toEqual(400);
    expect(resCreate.body.errors).toBeDefined();
  });
});
