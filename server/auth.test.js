import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from './server.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Auth Endpoints', () => {
  let app;
  let db;
  let serverInstance; // To hold the server instance
  let timers; // To hold the timer for clearing
  const testDbPath = path.join(__dirname, 'test-db.json');

  beforeAll(async () => {
    db = await JSONFilePreset(testDbPath, { orders: [], users: {}, credentials: {} });
    const mockSendEmail = jest.fn();
    const server = await startServer(db, null, mockSendEmail, testDbPath);
    app = server.app;
    timers = server.timers;
    serverInstance = app.listen();
  });

  beforeEach(async () => {
    db.data = { orders: [], users: {}, credentials: {} };
    await db.write();
  });

  afterAll(async () => {
    await new Promise(resolve => serverInstance.close(resolve));
      try {
        await fs.unlink(testDbPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
  });

  it('should respond to ping', async () => {
    const res = await request(app).get('/api/ping');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('ok');
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
    expect(db.data.users['testuser']).toBeDefined();
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
});
