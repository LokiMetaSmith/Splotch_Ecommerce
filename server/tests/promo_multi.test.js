import request from 'supertest';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { getCurrentSigningKey } from '../keyManager.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { JSONFilePreset } from 'lowdb/node';
import { LowDbAdapter } from '../database/lowdb_adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Admin Multi-Promo Code API & Validation', () => {
    let serverData;
    let startServer;
    let adminToken;
    let userToken;
    let testDbPath = path.join(__dirname, '..', 'test_promo_api_db.json');

    beforeAll(async () => {
        jest.setTimeout(60000);

        const initialData = { orders: {}, batches: {}, users: {}, emailIndex: {}, credentials: {}, config: {}, products: {} };
        fs.writeFileSync(testDbPath, JSON.stringify(initialData));

        process.env.TEST_USE_REAL_DB = 'true';
        process.env.TEST_DB_PATH = testDbPath;
        process.env.DB_PATH = testDbPath;
        process.env.ADMIN_EMAIL = 'admin@test.com';
        delete process.env.TEST_PRICING_PATH;

        const serverModule = await import('../server.js');
        startServer = serverModule.startServer;

        const lowDbInstance = await JSONFilePreset(testDbPath, { orders: {}, batches: {}, users: {}, emailIndex: {}, credentials: {}, config: {}, products: {} });
        const testDb = new LowDbAdapter(lowDbInstance);
        serverData = await startServer(testDb, null, undefined, testDbPath);

        const { privateKey, kid } = getCurrentSigningKey();
        adminToken = jwt.sign({ username: 'admin', email: 'admin@test.com' }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
        userToken = jwt.sign({ username: 'normal_user', email: 'user@test.com' }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    }, 60000);

    afterAll(async () => {
        if (serverData && serverData.timers) {
            if (Array.isArray(serverData.timers)) {
                serverData.timers.forEach((t) => clearInterval(t));
            } else if (typeof serverData.timers.backupInterval !== "undefined") {
                clearInterval(serverData.timers.backupInterval);
            }
        }
        if (serverData && serverData.server) {
            await new Promise((resolve) => serverData.server.close(resolve));
        }
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    async function getCsrf() {
        const res = await request(serverData.app).get('/api/csrf-token');
        return {
            token: res.body.csrfToken,
            cookie: res.headers['set-cookie'],
        };
    }

    test('GET /api/admin/promo/config returns default normalized structure', async () => {
        const res = await request(serverData.app)
            .get('/api/admin/promo/config')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.config.codes)).toBe(true);
    });

    test('POST /api/admin/promo/config saves multiple promo codes with expiration dates', async () => {
        const csrf = await getCsrf();
        const payload = {
            codes: [
                {
                    id: 'code_1',
                    code: 'SAVE25',
                    type: 'percentage',
                    amount: 25,
                    enabled: true,
                    maxUses: 100,
                    expiresAt: '2026-12-31'
                },
                {
                    id: 'code_2',
                    code: 'FLAT10',
                    type: 'flat',
                    amount: 10,
                    enabled: true,
                    maxUses: 50,
                    expiresAt: null
                },
                {
                    id: 'code_3',
                    code: 'OLDCODE',
                    type: 'percentage',
                    amount: 15,
                    enabled: true,
                    maxUses: 20,
                    expiresAt: '2025-01-01' // Expired
                }
            ]
        };

        const res = await request(serverData.app)
            .post('/api/admin/promo/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Token', csrf.token)
            .set('Cookie', csrf.cookie)
            .send(payload);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.config.codes.length).toBe(3);
        expect(res.body.config.codes[0].code).toBe('SAVE25');
        expect(res.body.config.codes[1].code).toBe('FLAT10');
        expect(res.body.config.codes[2].code).toBe('OLDCODE');
    });

    test('POST /api/admin/promo/config rejects duplicate codes', async () => {
        const csrf = await getCsrf();
        const payload = {
            codes: [
                { code: 'DUPLICATE', type: 'percentage', amount: 10, enabled: true },
                { code: 'duplicate', type: 'flat', amount: 5, enabled: true }
            ]
        };
        const res = await request(serverData.app)
            .post('/api/admin/promo/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Token', csrf.token)
            .set('Cookie', csrf.cookie)
            .send(payload);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Duplicate promo code');
    });

    test('POST /api/validate-promo validates active unexpired codes and calculates discount', async () => {
        // Valid active code SAVE25 (25% off 10000 cents = 2500 cents)
        const res = await request(serverData.app)
            .post('/api/validate-promo')
            .send({ code: 'save25', subtotalCents: 10000 });
        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.code).toBe('SAVE25');
        expect(res.body.discountCents).toBe(2500);

        // Valid active code FLAT10 ( off 10000 cents = 1000 cents)
        const res2 = await request(serverData.app)
            .post('/api/validate-promo')
            .send({ code: 'flat10', subtotalCents: 10000 });
        expect(res2.status).toBe(200);
        expect(res2.body.valid).toBe(true);
        expect(res2.body.code).toBe('FLAT10');
        expect(res2.body.discountCents).toBe(1000);
    });

    test('POST /api/validate-promo rejects expired code with clear message', async () => {
        const res = await request(serverData.app)
            .post('/api/validate-promo')
            .send({ code: 'oldcode', subtotalCents: 10000 });
        expect(res.status).toBe(400);
        expect(res.body.valid).toBe(false);
        expect(res.body.error).toBe('Promo code has expired.');
    });

    test('POST /api/validate-promo rejects non-existent code', async () => {
        const res = await request(serverData.app)
            .post('/api/validate-promo')
            .send({ code: 'DOESNOTEXIST', subtotalCents: 10000 });
        expect(res.status).toBe(400);
        expect(res.body.valid).toBe(false);
        expect(res.body.error).toBe('Invalid promo code.');
    });
});
