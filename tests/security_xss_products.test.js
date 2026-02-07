
import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { JSONFilePreset } from 'lowdb/node';

import { getCurrentSigningKey } from '../server/keyManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security XSS Products', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, '../server/test-db-security-products.json');
    let mockSquareClient;

    beforeAll(async () => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

        db = await JSONFilePreset(testDbPath, { orders: {}, users: {}, credentials: {}, config: {}, products: {} });

        bot = {
            telegram: {
                sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
                sendPhoto: jest.fn().mockResolvedValue({ message_id: 124 }),
                sendDocument: jest.fn().mockResolvedValue({ message_id: 125 }),
            }
        };

        mockSquareClient = {
            locations: { list: jest.fn() },
            payments: {
                create: jest.fn().mockResolvedValue({
                    payment: { id: 'p_1', orderId: 'sq_1', status: 'COMPLETED' }
                })
            }
        };

        process.env.SESSION_SECRET = 'test-secret'; // Ensure session secret is set

        // Mock WAF to bypass middleware blocking and test controller sanitization
        jest.unstable_mockModule('../server/waf.js', () => ({
            wafMiddleware: (req, res, next) => next(),
        }));
        const { startServer } = await import('../server/server.js');

        const server = await startServer(db, bot, jest.fn(), testDbPath, mockSquareClient);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen();
    });

    beforeEach(async () => {
        db.data.products = {};
        await db.write();
        jest.clearAllMocks();
    });

    afterAll(async () => {
        if (timers) timers.forEach(t => clearInterval(t));
        if (serverInstance) await new Promise(r => serverInstance.close(r));
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    const getAuthToken = () => {
        const { privateKey, kid } = getCurrentSigningKey();
        return jwt.sign({ username: 'test_creator', email: 'test@example.com' }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    };

    it('should SANITIZE malicious product names on creation', async () => {
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const token = getAuthToken();

        // Create user for the token if not exists (for products creator lookup)
        if (!db.data.users['test_creator']) {
             db.data.users['test_creator'] = { id: 'test_creator', username: 'test_creator', email: 'test@example.com' };
             if (!db.data.emailIndex) db.data.emailIndex = {};
             db.data.emailIndex['test@example.com'] = 'test_creator';
             await db.write();
        }

        const maliciousPayload = '<script>alert("XSS")</script>My Product';

        const res = await agent
            .post('/api/products')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrfRes.body.csrfToken)
            .send({
                name: maliciousPayload,
                designImagePath: '/uploads/valid.png',
                cutLinePath: '/uploads/cut.svg',
                creatorProfitCents: 100,
                defaults: {}
            });

        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);

        const product = res.body.product;
        // Verify the response is sanitized
        expect(product.name).not.toContain('<script>');
        expect(product.name).toContain('&lt;script&gt;');

        // Verify the DB storage is sanitized
        const storedProduct = db.data.products[product.productId];
        expect(storedProduct.name).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;My Product');
    });
});
