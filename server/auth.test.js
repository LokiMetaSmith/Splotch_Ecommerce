import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from './server.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { getCurrentSigningKey } from './keyManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Auth Endpoints', () => {
  let app;
  let db;
  let serverInstance; // To hold the server instance
  let timers; // To hold the timer for clearing
  let bot; // To hold the bot instance for cleanup
  let mockSendEmail; // Mock for sendEmail
  const testDbPath = path.join(__dirname, 'test-db.json');

  beforeAll(async () => {
    // Mock DB using memory instead of file I/O to avoid potential lock issues in test
    const data = { orders: [], users: {}, credentials: {}, config: {} };
    db = {
      data: data,
      write: async () => { console.log('[MOCK DB] write called'); },
      read: async () => { console.log('[MOCK DB] read called'); }
    };

    mockSendEmail = jest.fn();
    const server = await startServer(db, null, mockSendEmail, testDbPath);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    serverInstance = app.listen();
  });

  beforeEach(async () => {
    db.data = { orders: [], users: {}, credentials: {}, config: {}, emailIndex: {} };
    // db.write is no-op, so synchronous assignment is enough
    mockSendEmail.mockClear();
  });

  afterAll(async () => {
    if (bot) {
      await bot.stop('test');
    }
    // Clear timers
    timers.forEach(timer => clearInterval(timer));
    await new Promise(resolve => serverInstance.close(resolve));
      try {
        await fs.unlink(testDbPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
  });

  it('should pre-register a new user and return registration options', async () => {
    const agent = request.agent(app);
    const csrfRes = await agent.get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;

    const res = await agent
      .post('/api/auth/pre-register')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'testuser' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.challenge).toBeDefined();

    await db.read();
    const user = Object.values(db.data.users).find(u => u.username === 'testuser');
    expect(user).toBeDefined();
  });

  it('should login an existing user with correct credentials', async () => {
    const agent = request.agent(app);
    // 1. Get CSRF token
    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // 2. Register user
    await agent
      .post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'testuser', password: 'testpassword' });

    // 3. Login
    // It's good practice to get a fresh token before a new state-changing request
    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    const res = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'testuser', password: 'testpassword' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.token).toBeDefined();
  });

  it('should not login with a wrong password', async () => {
    const agent = request.agent(app);
    // 1. Get CSRF token
    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // 2. Register user
    await agent
      .post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'testuser', password: 'testpassword' });

    // 3. Attempt to login with wrong password
    // It's good practice to get a fresh token before a new state-changing request
    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    const res = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'testuser', password: 'wrongpassword' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toEqual('Invalid username or password');
  });

  it('should not login a user who has no password set', async () => {
    // Manually add a user without a password to the database
    db.data.users['passwordlessuser'] = {
      id: 'some-uuid',
      username: 'passwordlessuser',
      password: null // Explicitly null
    };
    await db.write();

    const agent = request.agent(app);
    const csrfRes = await agent.get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;

    const res = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'passwordlessuser', password: 'anypassword' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toEqual('Invalid username or password');
  });

  describe('Magic Link Authentication', () => {
    it('should send a magic link email but NOT create user immediately', async () => {
        const agent = request.agent(app);

        // Get CSRF Token
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;

        const email = 'test@example.com';

        const res = await agent
            .post('/api/auth/magic-login')
            .set('X-CSRF-Token', csrfToken)
            .send({ email });

        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        const emailArgs = mockSendEmail.mock.calls[0][0];
        expect(emailArgs.to).toEqual(email);
        expect(emailArgs.text).toContain('Click here to log in:');

        // Verify user was NOT created yet
        await db.read();
        const user = Object.values(db.data.users).find(u => u.email === email);
        expect(user).toBeUndefined();
    });

    it('should verify a valid magic link token and create user then', async () => {
        const agent = request.agent(app);
        const email = 'test-verify@example.com';

        // 1. Get CSRF Token
        let csrfRes = await agent.get('/api/csrf-token');
        let csrfToken = csrfRes.body.csrfToken;

        // 2. Request Magic Link
        await agent
            .post('/api/auth/magic-login')
            .set('X-CSRF-Token', csrfToken)
            .send({ email });

        // 3. Extract Token from Email
        const emailArgs = mockSendEmail.mock.calls[0][0];
        const linkMatch = emailArgs.text.match(/token=([a-zA-Z0-9._-]+)/);
        const token = linkMatch ? linkMatch[1] : null;
        expect(token).toBeTruthy();

        // 4. Verify Token
        // Refresh CSRF for next request
        csrfRes = await agent.get('/api/csrf-token');
        csrfToken = csrfRes.body.csrfToken;

        const res = await agent
            .post('/api/auth/verify-magic-link')
            .set('X-CSRF-Token', csrfToken)
            .send({ token });

        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
        expect(res.body.token).toBeDefined(); // Session token

        // 5. Verify Session Token
        const { publicKey } = getCurrentSigningKey();
        const decoded = jwt.verify(res.body.token, publicKey);
        expect(decoded.email).toEqual(email);

        // 6. Verify user exists NOW
        await db.read();
        const user = Object.values(db.data.users).find(u => u.email === email);
        expect(user).toBeDefined();
    });

    it('should reject an invalid magic link token', async () => {
        const agent = request.agent(app);

        // Get CSRF Token
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;

        const res = await agent
            .post('/api/auth/verify-magic-link')
            .set('X-CSRF-Token', csrfToken)
            .send({ token: 'invalid-token' });

        expect(res.statusCode).toEqual(401);
        expect(res.body.error).toEqual('Invalid or expired token');
    });

    it('should create a user when verifying a valid token for a new email', async () => {
        const email = 'nonexistent@example.com';
        // Generate a valid signed token for an email that doesn't exist in DB
        const { privateKey, kid } = getCurrentSigningKey();
        const token = jwt.sign({ email }, privateKey, { algorithm: 'RS256', expiresIn: '15m', header: { kid } });

        const agent = request.agent(app);

        // Get CSRF Token
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;

        const res = await agent
            .post('/api/auth/verify-magic-link')
            .set('X-CSRF-Token', csrfToken)
            .send({ token });

        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
        expect(res.body.token).toBeDefined();

        // Verify user exists NOW
        await db.read();
        const user = Object.values(db.data.users).find(u => u.email === email);
        expect(user).toBeDefined();
    });
  });
});
