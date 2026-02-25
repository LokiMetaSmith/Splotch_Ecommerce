
import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Username Validation', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-username-db.json');

  beforeAll(async () => {
    const data = { orders: [], users: {}, credentials: {}, config: {} };
    db = {
      data: data,
      write: async () => {},
      read: async () => {},
      getUser: async (username) => {
          return Object.values(db.data.users).find(u => u.username === username);
      },
      createUser: async (user) => { db.data.users[user.id] = user; },
      getConfig: async () => ({})
    };

    mockSendEmail = jest.fn();
    const server = await startServer(db, null, mockSendEmail, testDbPath);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    serverInstance = app.listen();
  });

  afterAll(async () => {
    if (bot) await bot.stop('test');
    timers.forEach(timer => clearInterval(timer));
    await new Promise(resolve => serverInstance.close(resolve));
    try { await fs.unlink(testDbPath); } catch (e) {}
  });

  const register = async (username) => {
    const agent = request.agent(app);
    const csrfRes = await agent.get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;

    return agent
      .post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username, password: 'password123' });
  };

  it('should accept valid usernames', async () => {
    const validUsernames = ['testuser', 'valid_user', 'user-name', 'User123', 'short'];
    for (const username of validUsernames) {
      const res = await register(username);
      expect(res.statusCode).toBe(200);
    }
  });

  it('should reject usernames that are too short', async () => {
    const res = await register('ab');
    expect(res.statusCode).toBe(400);
    expect(res.body.errors[0].msg).toContain('Username must be between 3 and 30 characters');
  });

  it('should reject usernames that are too long', async () => {
    const res = await register('a'.repeat(31));
    expect(res.statusCode).toBe(400);
    expect(res.body.errors[0].msg).toContain('Username must be between 3 and 30 characters');
  });

  it('should reject usernames with invalid characters (space)', async () => {
    const res = await register('user name');
    expect(res.statusCode).toBe(400);
    expect(res.body.errors[0].msg).toContain('Username can only contain letters, numbers, underscores, and hyphens');
  });

  it('should reject usernames with invalid characters (@)', async () => {
    const res = await register('user@name');
    expect(res.statusCode).toBe(400);
    expect(res.body.errors[0].msg).toContain('Username can only contain letters, numbers, underscores, and hyphens');
  });

  it('should reject usernames with HTML tags', async () => {
    const res = await register('<h1>hack</h1>');
    expect(res.statusCode).toBe(400);
    expect(res.body.errors[0].msg).toContain('Username can only contain letters, numbers, underscores, and hyphens');
  });

  it('should reject prototype pollution keys', async () => {
    const res = await register('__proto__');
    expect(res.statusCode).toBe(400);
    // This hits the custom validator which throws "Invalid username"
    // express-validator catches the throw and puts it in msg
    expect(res.body.errors[0].msg).toBe('Invalid username');
  });

  it('should reject constructor', async () => {
    const res = await register('constructor');
    expect(res.statusCode).toBe(400);
    expect(res.body.errors[0].msg).toBe('Invalid username');
  });
});
