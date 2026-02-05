import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import startServer
const { startServer } = await import('../server.js');

describe('GET /api/metrics', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let mockSendEmail;

  beforeAll(async () => {
    // Mock DB
    const data = { orders: {}, users: {}, credentials: {}, config: {}, products: {} };
    db = {
      data: data,
      write: async () => { }, // mocked
      read: async () => { }
    };

    mockSendEmail = jest.fn();

    // Start server
    const server = await startServer(db, null, mockSendEmail);
    app = server.app;
    timers = server.timers;
    serverInstance = app.listen();
  });

  afterAll(async () => {
    timers.forEach(timer => clearInterval(timer));
    await new Promise(resolve => serverInstance.close(resolve));
  });

  it('should deny access to unauthenticated users', async () => {
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(401);
  });

  it('should deny access to non-admin users', async () => {
    const agent = request.agent(app);
    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // Register user
    await agent
        .post('/api/auth/register-user')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'metric_user', password: 'password123' });

    // Login
    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    const loginRes = await agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'metric_user', password: 'password123' });
    const token = loginRes.body.token;

    const res = await request(app)
        .get('/api/metrics')
        .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('should allow access to admin users and return metrics', async () => {
    const agent = request.agent(app);
    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // Register admin
    await agent
        .post('/api/auth/register-user')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'metric_admin', password: 'password123' });

    // Elevate to admin in DB
    const user = Object.values(db.data.users).find(u => u.username === 'metric_admin');
    user.role = 'admin';

    // Login
    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    const loginRes = await agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'metric_admin', password: 'password123' });
    const token = loginRes.body.token;

    const res = await request(app)
        .get('/api/metrics')
        .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('api');
    expect(res.body).toHaveProperty('db');
    expect(res.body).toHaveProperty('system');

    // Check if db operations were tracked
    expect(res.body.db.write.total).toBeGreaterThan(0);
  });
});
