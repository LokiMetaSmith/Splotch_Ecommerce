
import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set env var before importing/running server
process.env.ENABLE_RATE_LIMIT_TEST = 'true';
// Enable trust proxy so we can spoof IP
process.env.TRUST_PROXY = 'true';

// Dynamic import to ensure env var is picked up
const { startServer } = await import('../server.js');

describe('Rate Limiting', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'rate-limit-test-db.json');

  beforeAll(async () => {
    // Mock DB
    const data = { orders: [], users: {}, credentials: {}, config: {}, emailIndex: {} };
    db = {
      data: data,
      write: async () => { },
      read: async () => { }
    };

    mockSendEmail = jest.fn();
    const server = await startServer(db, null, mockSendEmail, testDbPath);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    serverInstance = app.listen();
  });

  afterAll(async () => {
    if (bot && bot.stop) {
      await bot.stop('test');
    }
    timers.forEach(timer => clearInterval(timer));
    await new Promise(resolve => serverInstance.close(resolve));
    try {
        await fs.unlink(testDbPath);
    } catch (e) {}
  });

  it('should rate limit /api/auth/pre-register', async () => {
    const agent = request.agent(app);
    const csrfRes = await agent.get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;

    // Use a unique IP for this test
    const ip = '1.2.3.4';

    for (let i = 0; i < 15; i++) {
      const res = await agent
        .post('/api/auth/pre-register')
        .set('X-CSRF-Token', csrfToken)
        .set('X-Forwarded-For', ip)
        .send({ username: `user_A_${i}` });

      if (i < 10) {
          expect(res.status).not.toBe(429);
      } else {
          expect(res.status).toBe(429);
      }
    }
  });

  it('should rate limit /api/auth/issue-temp-token', async () => {
      const agent = request.agent(app);

      const csrfRes = await agent.get('/api/csrf-token');
      const csrfToken = csrfRes.body.csrfToken;

      // Use a unique IP for this test
      const ip = '5.6.7.8';

      for (let i = 0; i < 15; i++) {
          const res = await agent
            .post('/api/auth/issue-temp-token')
            .set('X-CSRF-Token', csrfToken)
            .set('X-Forwarded-For', ip)
            .send({ email: `test${i}@example.com` });

          if (i < 10) {
              expect(res.status).not.toBe(429);
          } else {
              expect(res.status).toBe(429);
          }
      }
  });
});
