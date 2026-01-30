
import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock pricing.js
jest.unstable_mockModule('../pricing.js', () => ({
    calculateStickerPrice: jest.fn().mockReturnValue({ total: 100, complexityMultiplier: 1 }),
    getDesignDimensions: jest.fn().mockResolvedValue({ bounds: { width: 100, height: 100 }, cutline: [] }),
    calculatePerimeter: jest.fn().mockReturnValue(100),
}));

// Dynamic import after mocking
const { startServer } = await import('../server.js');

describe('Security: Input Validation Enhancement', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-validation-enhancement.json');

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
      read: async () => { }
    };

    mockSendEmail = jest.fn();

    // Ensure dummy file exists for tests (even if mocked, server checks existence)
    const uploadsDir = path.join(__dirname, '../uploads');
    try {
        await fs.mkdir(uploadsDir, { recursive: true });
        // Create a minimal valid PNG
        const minimalPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
        await fs.writeFile(path.join(uploadsDir, 'test_val.png'), minimalPng);
    } catch (error) {
        console.warn('Could not create dummy test file:', error);
    }

    // Pass mock Square client
    const server = await startServer(db, null, mockSendEmail, testDbPath, mockSquareClient);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    serverInstance = app.listen();
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
    try {
        await fs.unlink(path.join(__dirname, '../uploads/test_val.png'));
    } catch (error) {
        // ignore
    }
  });

  it('should currently accept invalid material and resolution (reproduction)', async () => {
    // 1. Register/Login to get Token
    const agent = request.agent(app);

    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // Create user
    await agent
        .post('/api/auth/register-user')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'tester', password: 'password123' });

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    const loginRes = await agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'tester', password: 'password123' });

    if (loginRes.status !== 200) {
        console.log('Login failed:', loginRes.status, loginRes.body);
    }
    const authToken = loginRes.body.token;

    // Refresh CSRF Token for the order creation
    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    // 2. Create Order with invalid material
    const payload = {
      sourceId: 'cnon:card-nonce-ok',
      amountCents: 100, // Matches mocked total (100)
      currency: 'USD',
      designImagePath: '/uploads/test_val.png',
      orderDetails: {
          quantity: 1,
          material: 'INVALID_MATERIAL_STRING',
          resolution: 'INVALID_RESOLUTION_STRING'
      },
      shippingContact: {
        givenName: 'Tester',
        addressLines: ['123 Test St'],
        locality: 'Testville',
        administrativeDistrictLevel1: 'CA',
        postalCode: '90210',
        country: 'US'
      },
      billingContact: {
        givenName: 'Tester',
        email: 'tester@example.com'
      }
    };

    const res = await agent
      .post('/api/create-order')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send(payload);

    if (res.status !== 400) {
        console.log('Status:', res.status);
        console.log('Body:', res.body);
    }
    expect(res.status).toBe(400); // Expect rejection now

    // Verify error message
    expect(res.body.errors).toBeDefined();
    const materialError = res.body.errors.find(e => e.msg.includes('Invalid material'));
    const resolutionError = res.body.errors.find(e => e.msg.includes('Invalid resolution'));
    expect(materialError).toBeDefined();
    expect(resolutionError).toBeDefined();
  });
});
