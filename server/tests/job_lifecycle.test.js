import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSONFilePreset } from 'lowdb/node';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mockSquareClient = {
    locations: {},
    payments: {
      create: jest.fn().mockResolvedValue({
        payment: { id: 'mock_payment_id', orderId: 'mock_square_order_id' }
      })
    }
  };

describe('Job Lifecycle', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let mockSendEmail;
  let testDbPath;
  let closeQueues;
  const mockImagePath = path.join(__dirname, '../uploads', 'test-design.png');

  beforeAll(async () => {
    testDbPath = path.join(__dirname, 'test-db-job-lifecycle.json');
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(mockImagePath)) {
        fs.unlinkSync(mockImagePath);
    }

    const defaultData = { orders: {}, users: {}, credentials: {}, config: {}, products: {} };
    // Create a mock uploaded file
    if (!fs.existsSync(path.join(__dirname, '../uploads'))) {
        fs.mkdirSync(path.join(__dirname, '../uploads'));
    }
    fs.writeFileSync(mockImagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64'));
    const lowdbInstance = await JSONFilePreset(testDbPath, defaultData);

    const { getDatabaseAdapter } = await import('../database/index.js');
    db = getDatabaseAdapter(lowdbInstance);

    mockSendEmail = jest.fn();

    // Dynamic import
    jest.unstable_mockModule('../pricing.js', () => ({
      validatePrice: jest.fn().mockResolvedValue(true),
      getDesignDimensions: jest.fn().mockResolvedValue({ width: 10, height: 10 }),
      calculateStickerPrice: jest.fn().mockReturnValue(15),
      calculatePerimeter: jest.fn().mockReturnValue(10),
      clearDimensionsCache: jest.fn()
    }));

    // Must dynamically import startServer AFTER mocking pricing module
    const { startServer: mockedStartServer } = await import('../server.js');
    const serverModule = await mockedStartServer(db, null, mockSendEmail, testDbPath, mockSquareClient);
    app = serverModule.app;
    timers = serverModule.timers;
    serverInstance = serverModule.server;
    closeQueues = serverModule.closeQueues;
  }, 30000);

  afterAll(async () => {
    if (serverInstance) {
        await new Promise(resolve => serverInstance.close(resolve));
    }

    if (timers) {
        for (const timer of Object.values(timers)) {
            clearInterval(timer);
        }
    }

    if (closeQueues) {
        await closeQueues();
    }

    if (db && db._watcher) {
        db._watcher.unref();
    }

    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(mockImagePath)) {
        fs.unlinkSync(mockImagePath);
    }
  });

  it('should successfully complete a job lifecycle as admin', async () => {
    const agent = request.agent(app);

    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    await agent
        .post('/api/auth/register-user')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'printshop_admin', password: 'securepassword123' });

    const user = await db.getUser('printshop_admin');
    expect(user).toBeDefined();
    user.role = 'admin';
    await db.updateUser(user);

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    const loginRes = await agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'printshop_admin', password: 'securepassword123' });

    expect(loginRes.status).toBe(200);
    const token = loginRes.body.token;
    expect(token).toBeDefined();

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    const orderRes = await agent
        .post('/api/create-order')
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', csrfToken)
        .send({
            sourceId: 'nonce-12345',
            amountCents: 15,
            currency: 'USD',
            designImagePath: '/uploads/test-design.png',
            orderDetails: {
                quantity: 1,
                material: 'pp_standard',
                resolution: 'dpi_300'
            },
            billingContact: {
                givenName: 'Test',
                familyName: 'User',
                email: 'test@example.com'
            },
            shippingContact: {
                givenName: 'Test',
                familyName: 'User',
                email: 'test@example.com',
                addressLines: ['123 Test St'],
                locality: 'Testville',
                administrativeDistrictLevel1: 'TS',
                postalCode: '12345',
                country: 'US'
            }
        });

    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.order.orderId;
    expect(orderId).toBeDefined();

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    const status1Res = await agent
        .post(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ status: 'PRINTING' });

    expect(status1Res.status).toBe(200);
    expect(status1Res.body.order.status).toBe('PRINTING');

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    const status2Res = await agent
        .post(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ status: 'SHIPPED' });

    expect(status2Res.status).toBe(200);
    expect(status2Res.body.order.status).toBe('SHIPPED');

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    const status3Res = await agent
        .post(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ status: 'DELIVERED' });

    expect(status3Res.status).toBe(200);
    expect(status3Res.body.order.status).toBe('DELIVERED');

    const finalOrderRes = await agent
        .get(`/api/orders/${orderId}`)
        .set('Authorization', `Bearer ${token}`);

    expect(finalOrderRes.status).toBe(200);
    if (finalOrderRes.body.order) {
        expect(finalOrderRes.body.order.status).toBe('DELIVERED');
    } else {
        expect(finalOrderRes.body.status).toBe('DELIVERED');
    }
  });

  it('should deny status updates for non-admin users', async () => {
    const agent = request.agent(app);

    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    await agent
        .post('/api/auth/register-user')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'printshop_user', password: 'securepassword123' });

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    const loginRes = await agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'printshop_user', password: 'securepassword123' });

    expect(loginRes.status).toBe(200);
    const token = loginRes.body.token;

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    const orderRes = await agent
        .post('/api/create-order')
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', csrfToken)
        .send({
            sourceId: 'nonce-67890',
            amountCents: 15,
            currency: 'USD',
            designImagePath: '/uploads/test-design.png',
            orderDetails: {
                quantity: 1,
                material: 'pp_standard',
                resolution: 'dpi_300'
            },
            billingContact: {
                givenName: 'Test2',
                familyName: 'User2',
                email: 'test2@example.com'
            },
            shippingContact: {
                givenName: 'Test2',
                familyName: 'User2',
                email: 'test2@example.com',
                addressLines: ['123 Test St'],
                locality: 'Testville',
                administrativeDistrictLevel1: 'TS',
                postalCode: '12345',
                country: 'US'
            }
        });

    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.order.orderId;

    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;
    const status1Res = await agent
        .post(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ status: 'PRINTING' });

    expect(status1Res.status).toBe(403); // Forbidden
  });
});
