import './setupEnv.js';
import request from 'supertest';
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { getCurrentSigningKey } from '../keyManager.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { JSONFilePreset } from 'lowdb/node';
import { LowDbAdapter } from '../database/lowdb_adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Promo Code Management API', () => {
  let serverData;
  let adminToken;
  let userToken;
  let testDb;
  const testDbPath = path.join(__dirname, '..', 'test_promo_api_db.json');

  beforeAll(async () => {
    const initialData = {
      orders: {},
      batches: {},
      users: {
        admin: { username: 'admin', email: 'admin@test.com', role: 'admin' },
        user: { username: 'normal_user', email: 'user@test.com', role: 'user' },
      },
      emailIndex: {},
      credentials: {},
      config: {
        promo: {
          enabled: false,
          code: '',
          type: 'percentage',
          amount: 0,
          maxUses: null,
          timesUsed: 0,
        },
      },
      products: {},
    };
    fs.writeFileSync(testDbPath, JSON.stringify(initialData));

    process.env.TEST_USE_REAL_DB = 'true';
    process.env.TEST_DB_PATH = testDbPath;
    process.env.DB_PATH = testDbPath;
    process.env.ADMIN_EMAIL = 'admin@test.com';
    process.env.NODE_ENV = 'test';

    const serverModule = await import('../server.js');
    const startServer = serverModule.startServer;

    const lowDbInstance = await JSONFilePreset(testDbPath, initialData);
    testDb = new LowDbAdapter(lowDbInstance);
    serverData = await startServer(testDb, null, undefined, testDbPath);

    const { privateKey, kid } = getCurrentSigningKey();
    adminToken = jwt.sign(
      { username: 'admin', email: 'admin@test.com' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '1h', header: { kid } },
    );
    userToken = jwt.sign(
      { username: 'normal_user', email: 'user@test.com' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '1h', header: { kid } },
    );
  }, 60000);

  afterAll(async () => {
    if (serverData && serverData.timers) {
      if (serverData.server?.close) await serverData.server.close();
      if (serverData.close) await serverData.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    delete process.env.TEST_USE_REAL_DB;
    delete process.env.DB_PATH;
    delete process.env.ADMIN_EMAIL;
  }, 60000);

  it('GET /api/admin/promo/config should reject unauthenticated or non-admin access', async () => {
    const unauthRes = await request(serverData.app).get('/api/admin/promo/config');
    expect(unauthRes.status).toBe(401);

    const userRes = await request(serverData.app)
      .get('/api/admin/promo/config')
      .set('Authorization', `Bearer ${userToken}`);
    expect(userRes.status).toBe(403);
  });

  it('GET /api/admin/promo/config should return promo config for admin', async () => {
    const res = await request(serverData.app)
      .get('/api/admin/promo/config')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.config).toBeDefined();
    expect(res.body.config.enabled).toBe(false);
  });

  it('POST /api/admin/promo/config should validate inputs and update config', async () => {
    const csrfRes = await request(serverData.app).get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;
    const cookies = csrfRes.headers['set-cookie'];

    // Invalid payload: missing code when enabled
    const invalidRes = await request(serverData.app)
      .post('/api/admin/promo/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({
        enabled: true,
        code: '',
        type: 'percentage',
        amount: 20,
      });
    expect(invalidRes.status).toBe(400);

    // Valid payload: update promo config
    const validRes = await request(serverData.app)
      .post('/api/admin/promo/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({
        enabled: true,
        code: 'SAVE25',
        type: 'percentage',
        amount: 25,
        maxUses: 50,
      });

    expect(validRes.status).toBe(200);
    expect(validRes.body.success).toBe(true);
    expect(validRes.body.config.code).toBe('SAVE25');
    expect(validRes.body.config.enabled).toBe(true);
    expect(validRes.body.config.amount).toBe(25);
    expect(validRes.body.config.maxUses).toBe(50);
  });

  it('POST /api/validate-promo should validate active promo code', async () => {
    // Valid code
    const validRes = await request(serverData.app)
      .post('/api/validate-promo')
      .send({
        code: 'save25',
        subtotalCents: 2000,
      });

    expect(validRes.status).toBe(200);
    expect(validRes.body.valid).toBe(true);
    expect(validRes.body.code).toBe('SAVE25');
    expect(validRes.body.discountCents).toBe(500); // 25% of 2000 = 500

    // Invalid code
    const invalidRes = await request(serverData.app)
      .post('/api/validate-promo')
      .send({
        code: 'WRONGCODE',
        subtotalCents: 2000,
      });

    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.valid).toBe(false);
  });

  it('POST /api/order/estimate should apply promo discount in estimate', async () => {
    const res = await request(serverData.app)
      .post('/api/order/estimate')
      .send({
        subtotalCents: 2000,
        areaInSqIn: 10,
        destinationState: 'OK',
        deliveryMethod: 'ship',
        promoCode: 'SAVE25',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.isPromoApplied).toBe(true);
    expect(res.body.promoDiscountCents).toBe(500);
    expect(res.body.discountedSubtotalCents).toBe(1500);
  });

  it('POST /api/validate-promo should reject when usage limit is reached', async () => {
    const csrfRes = await request(serverData.app).get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;
    const cookies = csrfRes.headers['set-cookie'];

    // Update to 1 max use
    await request(serverData.app)
      .post('/api/admin/promo/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({
        enabled: true,
        code: 'LIMITED1',
        type: 'flat',
        amount: 5,
        maxUses: 1,
        resetTimesUsed: true,
      });

    // Valid before limit
    const res1 = await request(serverData.app)
      .post('/api/validate-promo')
      .send({ code: 'LIMITED1', subtotalCents: 1000 });
    expect(res1.status).toBe(200);
    expect(res1.body.valid).toBe(true);

    // Simulate redemption
    const cfg = await testDb.getConfig();
    await testDb.setConfig('promo', { ...cfg.promo, timesUsed: 1 });

    // Invalid after limit
    const res2 = await request(serverData.app)
      .post('/api/validate-promo')
      .send({ code: 'LIMITED1', subtotalCents: 1000 });
    expect(res2.status).toBe(400);
    expect(res2.body.valid).toBe(false);
    expect(res2.body.error).toContain('limit');
  });
});
