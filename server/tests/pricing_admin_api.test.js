import request from 'supertest';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { getCurrentSigningKey } from '../keyManager.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Admin Pricing API', () => {
    let serverData;
    let startServer;
    let adminToken;
    let userToken;
    let testDbPath = path.join(__dirname, '..', 'test_pricing_api_db.json');
    let testPricingPath = path.join(__dirname, '..', 'test_pricing.json');

    beforeAll(async () => {
        jest.setTimeout(60000);



        // Setup mock DB
        const initialData = { orders: {}, batches: {}, users: {}, emailIndex: {}, credentials: {}, config: {}, products: {} };
        fs.writeFileSync(testDbPath, JSON.stringify(initialData));

        // Setup mock pricing.json
        const initialPricing = {
            pricePerSquareInchCents: 10,
            resolutions: [{ id: "dpi_300", name: "300 DPI", ppi: 300, costMultiplier: 1.0 }],
            materials: [{ id: "mat_1", name: "Material 1", costMultiplier: 1.0, supportedLayers: ["white"], description: "" }],
            layers: [{ id: "white", name: "White", costMultiplier: 1.0 }],
            complexity: { description: "Test", perLayerMultiplier: 0.1, tiers: [{ thresholdInches: 12, multiplier: 1.0 }] },
            quantityDiscounts: [{ quantity: 1, discount: 0.0 }]
        };
        fs.writeFileSync(testPricingPath, JSON.stringify(initialPricing));

        process.env.TEST_USE_REAL_DB = 'true';
        process.env.TEST_DB_PATH = testDbPath;
        process.env.DB_PATH = testDbPath;
        process.env.ADMIN_EMAIL = 'admin@test.com';
        process.env.TEST_PRICING_PATH = testPricingPath;

        const serverModule = await import('../server.js');
        startServer = serverModule.startServer;

        const { JSONFilePreset } = require("lowdb/node");
const { LowDbAdapter } = require("../database/lowdb_adapter.js");
const lowDbInstance = await JSONFilePreset(testDbPath, { orders: {}, batches: {}, users: {}, emailIndex: {}, credentials: {}, config: {}, products: {} });
const testDb = new LowDbAdapter(lowDbInstance);
serverData = await startServer(testDb, null, undefined, testDbPath);

        const { privateKey, kid } = getCurrentSigningKey();

        // Setup initial admin and normal user tokens for testing roles
        adminToken = jwt.sign({ username: 'admin', email: 'admin@test.com' }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
        userToken = jwt.sign({ username: 'normal_user', email: 'user@test.com' }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    });

    afterAll(async () => {
        if (serverData && serverData.timers) {
            if (typeof serverData.server !== "undefined" && serverData.server.close) await serverData.server.close();
            if (typeof serverData.close !== "undefined") await serverData.close();
        }
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        if (fs.existsSync(testPricingPath)) {
            fs.unlinkSync(testPricingPath);
        }
        delete process.env.TEST_USE_REAL_DB;
        delete process.env.DB_PATH;
        delete process.env.ADMIN_EMAIL;
        delete process.env.TEST_PRICING_PATH;
    });

    it('should retrieve pricing info publicly', async () => {
        const res = await request(serverData.app).get('/api/pricing-info');
        expect(res.status).toBe(200);
        expect(res.body.pricePerSquareInchCents).toBe(10);
    });

    it('should block pricing update when called by a normal user', async () => {
        const csrfRes = await request(serverData.app).get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const cookies = csrfRes.headers['set-cookie'];

        const res = await request(serverData.app)
            .post('/api/admin/pricing')
            .set('Authorization', `Bearer ${userToken}`)
            .set('Cookie', cookies)
            .set('X-CSRF-Token', csrfToken)
            .send({ pricePerSquareInchCents: 999 });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Forbidden');
    });

    it('should update pricing when called by an admin', async () => {
        const csrfRes = await request(serverData.app).get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const cookies = csrfRes.headers['set-cookie'];

        const newPricing = {
            pricePerSquareInchCents: 25, // Updated value
            resolutions: [{ id: "dpi_600", name: "600 DPI", ppi: 600, costMultiplier: 1.5 }],
            materials: [],
            layers: [],
            complexity: { tiers: [] },
            quantityDiscounts: []
        };

        const res = await request(serverData.app)
            .post('/api/admin/pricing')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('Cookie', cookies)
            .set('X-CSRF-Token', csrfToken)
            .send(newPricing);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.pricing.pricePerSquareInchCents).toBe(25);

        // Verify it was written to disk and loaded by the GET endpoint
        const getRes = await request(serverData.app).get('/api/pricing-info');
        expect(getRes.status).toBe(200);
        expect(getRes.body.pricePerSquareInchCents).toBe(25);
        expect(getRes.body.resolutions[0].id).toBe("dpi_600");

        // Verify the file itself was updated
        const savedPricing = JSON.parse(fs.readFileSync(testPricingPath, 'utf8'));
        expect(savedPricing.pricePerSquareInchCents).toBe(25);
    });

    it('should reject structurally invalid pricing updates', async () => {
        const csrfRes = await request(serverData.app).get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const cookies = csrfRes.headers['set-cookie'];

        const res = await request(serverData.app)
            .post('/api/admin/pricing')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('Cookie', cookies)
            .set('X-CSRF-Token', csrfToken)
            .send({ invalidField: true }); // Missing pricePerSquareInchCents

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid pricing configuration structure.');
    });
});
