import request from 'supertest';
import { startServer } from './server.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let app;
let db;
let tokenRotationTimer;
const testDbPath = path.join(__dirname, 'test-db.json');

beforeAll(async () => {
  // Create a single db instance for the test suite
  db = await JSONFilePreset(testDbPath, { orders: [], users: {}, credentials: {} });
  // Create a mock sendEmail function
  const mockSendEmail = jest.fn();
  // Initialize the app with the test database instance and mock emailer
  const server = await startServer(db, null, mockSendEmail, testDbPath);
  app = server.app;
  tokenRotationTimer = server.tokenRotationTimer;
});

beforeEach(async () => {
  // Reset the test database state before each test using the shared db instance
  db.data = { orders: [], users: {}, credentials: {} };
  await db.write();
});

afterAll(async () => {
  // Clean up the test database file and clear the timer
  clearInterval(tokenRotationTimer);
  await fs.unlink(testDbPath);
});

describe('Auth Endpoints', () => {
  it('should respond to ping', async () => {
    const res = await request(app).get('/api/ping');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('ok');
  });

  it('should pre-register a new user and return registration options', async () => {
    const csrfRes = await request(app).get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;
    const cookie = csrfRes.headers['set-cookie'];

    const res = await request(app)
      .post('/api/auth/pre-register')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrfToken)
      .send({ username: 'testuser' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.challenge).toBeDefined();

    // The user should now exist in the db instance shared with the server
    await db.read();
    expect(db.data.users['testuser']).toBeDefined();
  });

  it('should login an existing user with correct credentials', async () => {
    // 1. Get CSRF token
    const csrfRes = await request(app).get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;
    const cookie = csrfRes.headers['set-cookie'];

    // 2. Register user
    await request(app)
      .post('/api/auth/register-user')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrfToken)
      .send({ username: 'testuser', password: 'testpassword' });

    // 3. Login
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrfToken)
      .send({ username: 'testuser', password: 'testpassword' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.token).toBeDefined();
  });

  it('should not login with a wrong password', async () => {
    // 1. Get CSRF token
    const csrfRes = await request(app).get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;
    const cookie = csrfRes.headers['set-cookie'];

    // 2. Register user
    await request(app)
      .post('/api/auth/register-user')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrfToken)
      .send({ username: 'testuser', password: 'testpassword' });

    // 3. Attempt to login with wrong password
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrfToken)
      .send({ username: 'testuser', password: 'wrongpassword' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toEqual('Invalid username or password');
  });
});
