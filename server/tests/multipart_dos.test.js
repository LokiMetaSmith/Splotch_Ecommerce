import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security: Multipart DoS Protection', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-multipart.json');

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
      read: async () => { },
      // Mock methods needed for auth
      getUser: async (username) => Object.values(data.users).find(u => u.username === username),
      getUserByEmail: async (email) => Object.values(data.users).find(u => u.email === email),
      createUser: async (user) => { data.users[user.id] = user; return user; },
      updateUser: async (user) => { data.users[user.id] = user; return user; },
      getConfig: async () => data.config,
      setConfig: async (k, v) => { data.config[k] = v; },
    };

    mockSendEmail = jest.fn();

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

  it('should reject requests with excessive multipart fields (DoS protection)', async () => {
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

    // 3. Send Request with excessive fields
    const req = agent
      .post('/api/upload-design')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-CSRF-Token', csrfToken)
      .attach('designImage', path.join(__dirname, '../../favicon.png'));

    // Append 100 extra fields (limit is 50)
    for (let i = 0; i < 100; i++) {
        req.field(`extra_field_${i}`, `value_${i}`);
    }

    const res = await req;

    // Expect 500 Internal Server Error (Multer error caught by Express default handler)
    // Or 400 if we had a custom error handler for MulterError
    expect(res.statusCode).not.toEqual(200);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  }, 30000);

  it('should allow valid requests within limits', async () => {
    const agent = request.agent(app);

    // 1. Get CSRF Token
    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // 2. Register/Login
    await agent
      .post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'valid_user', password: 'password123' });

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'valid_user', password: 'password123' });

    const authToken = loginRes.body.token;

    // 3. Send Valid Request
    const res = await agent
      .post('/api/upload-design')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-CSRF-Token', csrfToken)
      .attach('designImage', path.join(__dirname, '../../favicon.png'))
      .field('some_valid_field', 'some_value');

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
  });
});
