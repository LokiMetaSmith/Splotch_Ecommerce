
import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { getCurrentSigningKey } from '../keyManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('WAF Multipart Integration Test', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-waf-multipart.json');

  beforeAll(async () => {
    // Mock DB
    const data = { orders: [], users: {}, credentials: {}, config: {} };
    db = {
      data: data,
      write: async () => {},
      read: async () => {},
      getUser: async (username) => Object.values(data.users).find(u => u.username === username),
      getUserByEmail: async (email) => Object.values(data.users).find(u => u.email === email),
      getConfig: async () => ({}),
      getInventoryCache: async () => ({}),
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
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
  });

  it('should BLOCK malicious text field in multipart request (VULNERABILITY FIXED)', async () => {
    const agent = request.agent(app);

    // 0. Get CSRF Token
    const csrfRes = await agent.get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;

    // 1. Create a token for authentication
    const { privateKey, kid } = getCurrentSigningKey();
    const token = jwt.sign({ username: 'testuser' }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });

    // 2. Create a dummy SVG buffer
    const svgBuffer = Buffer.from('<svg><circle cx="50" cy="50" r="40" /></svg>');

    // 3. Make the multipart request with a malicious field
    const res = await agent
      .post('/api/upload-design')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrfToken)
      // Attach file to satisfy route requirement
      .attach('designImage', svgBuffer, 'test.svg')
      // Attach malicious text field
      .field('description', '<script>alert("XSS")</script>');

    // Expectation:
    // WAF should now run after multer populates the body, detecting the malicious field.

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });
});
