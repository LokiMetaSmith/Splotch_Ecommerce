
import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock dependencies
jest.unstable_mockModule('../pricing.js', () => ({
    calculateStickerPrice: jest.fn().mockReturnValue({ total: 100, complexityMultiplier: 1 }),
    getDesignDimensions: jest.fn().mockResolvedValue({ bounds: { width: 100, height: 100 }, cutline: [] }),
    calculatePerimeter: jest.fn().mockReturnValue(100),
}));

// Dynamic import after mocking
const { startServer } = await import('../server.js');

describe('Security: Strict ID Validation', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let authToken;
  let csrfToken;

  const testDbPath = path.join(__dirname, 'test-db-id-validation.json');

  beforeAll(async () => {
    // Mock DB
    const data = { orders: {}, users: {}, credentials: {}, config: {}, products: {} };
    db = {
      data: data,
      write: async () => { },
      read: async () => { },
      getUser: async (username) => data.users[username],
      getUserByEmail: async (email) => Object.values(data.users).find(u => u.email === email),
      createUser: async (user) => { data.users[user.username] = user; },
      getOrder: async (id) => null, // Always return null for getOrder to simulate not found
      getConfig: async () => ({}),
      setConfig: async () => {},
      saveCredential: async () => {},
      getCredential: async () => null,
      getInventoryCache: async () => ({}),
      getUserOrders: async () => [],
      searchOrders: async () => [],
      getAllOrders: async () => [],
      updateUser: async () => {},
      getProduct: async () => null,
    };

    const mockSendEmail = jest.fn();
    const mockSquareClient = {
        locations: {},
        payments: {}
    };

    const server = await startServer(db, null, mockSendEmail, testDbPath, mockSquareClient);
    app = server.app;
    timers = server.timers;
    serverInstance = app.listen();

    // Register and Login to get token
    const agent = request.agent(app);
    let csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    await agent
        .post('/api/auth/register-user')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'tester', password: 'password123' });

    const loginRes = await agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'tester', password: 'password123' });

    authToken = loginRes.body.token;
  });

  afterAll(async () => {
    timers.forEach(timer => clearInterval(timer));
    await new Promise(resolve => serverInstance.close(resolve));
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
       // ignore
    }
  });

  it('should reject non-UUID orderId containing XSS payload with 403 Forbidden (WAF)', async () => {
    const maliciousId = '<script>alert(1)</script>';

    // The WAF middleware runs first and should block this
    const res = await request(app)
      .get(`/api/orders/${maliciousId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('should reject simple non-UUID string with 400 Bad Request', async () => {
    const invalidId = '12345';
    // This is not blocked by WAF but fails strict UUID validation
    const res = await request(app)
      .get(`/api/orders/${invalidId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
    // Verify it's an ID validation error
    const idError = res.body.errors.find(e => e.msg.includes('Invalid ID'));
    expect(idError).toBeDefined();
  });

  it('should accept valid UUID', async () => {
      const validUuid = '550e8400-e29b-41d4-a716-446655440000';
      const res = await request(app)
        .get(`/api/orders/${validUuid}`)
        .set('Authorization', `Bearer ${authToken}`);

      // Expect 404 because the order doesn't exist in our mock DB,
      // but validation should PASS (so not 400).
      expect(res.status).toBe(404);
  });
});
