import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server/server.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Auth Rate Limiting', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'rate-limit-test-db.json');

  beforeAll(async () => {
    // Enable strict rate limiting for this test
    process.env.ENABLE_RATE_LIMIT_TEST = 'true';

    db = await JSONFilePreset(testDbPath, { orders: [], users: {}, credentials: {}, config: {} });
    mockSendEmail = jest.fn();
    // We pass null for injectedSquareClient to trigger the "test environment" logic in startServer
    const server = await startServer(db, null, mockSendEmail, testDbPath);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    serverInstance = app.listen();
  });

  beforeEach(async () => {
    db.data = { orders: [], users: {}, credentials: {}, config: {} };
    await db.write();
    mockSendEmail.mockClear();
  });

  afterAll(async () => {
    delete process.env.ENABLE_RATE_LIMIT_TEST; // Cleanup env var

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
  });

  it('should block login attempts after 5 failures (Rate Limit)', async () => {
    const agent = request.agent(app);

    // 1. Get CSRF Token
    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // 2. Register a user
    await agent
      .post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'victim', password: 'password123' });

    // 3. Attempt to login 11 times with wrong password
    // The rate limit is 10 attempts shared across auth endpoints.
    // We already used 1 attempt for registration.
    // So we have 9 attempts left.
    // i=1 to 9: OK (Total 10)
    // i=10: Blocked (Total 11)
    for (let i = 1; i <= 10; i++) {
        csrfRes = await agent.get('/api/csrf-token');
        csrfToken = csrfRes.body.csrfToken;

        const res = await agent
            .post('/api/auth/login')
            .set('X-CSRF-Token', csrfToken)
            .send({ username: 'victim', password: 'wrongpassword' });

        if (i <= 9) {
            expect(res.statusCode).toBe(400); // Bad Request (Wrong password)
        } else {
            expect(res.statusCode).toBe(429); // Too Many Requests
            expect(res.text).toContain('Too many login attempts');
        }
    }
  });
});
