import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { JSONFilePreset } from 'lowdb/node';
import { startServer } from '../server/server.js';
import { getCurrentSigningKey } from '../server/keyManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Input Validation Security Tests', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, 'test-db-validation.json');

    beforeAll(async () => {
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        db = await JSONFilePreset(testDbPath, { orders: {}, users: {}, credentials: {}, config: {}, products: {} });

        // Mock Bot
        bot = {
            telegram: {
                sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
                editMessageText: jest.fn().mockResolvedValue(true),
                deleteMessage: jest.fn().mockResolvedValue(true)
            },
            stopPolling: jest.fn()
        };

        const mockSendEmail = jest.fn().mockResolvedValue(true);
        const mockSquareClient = {
             locations: { list: jest.fn() },
             payments: { create: jest.fn() }
        };

        process.env.ADMIN_EMAIL = 'admin@example.com';
        process.env.NODE_ENV = 'test';

        const server = await startServer(db, bot, mockSendEmail, testDbPath, mockSquareClient);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen();
    });

    beforeEach(async () => {
        db.data.orders = {};
        db.data.users = {};
        db.data.emailIndex = {};
        db.data.products = {};
        await db.write();
        jest.clearAllMocks();
    });

    afterAll(async () => {
        if (timers) timers.forEach(timer => clearInterval(timer));
        if (serverInstance) await new Promise(resolve => serverInstance.close(resolve));
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    const getAuthToken = (username = 'testuser', email = 'test@example.com') => {
        const { privateKey, kid } = getCurrentSigningKey();
        return jwt.sign({ username, email }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    };

    describe('GET /api/orders/search', () => {
        it('should return 400 for empty search query', async () => {
            const email = 'user@example.com';
            db.data.users['user'] = { email, username: 'user' };
            db.data.emailIndex[email] = 'user';
            await db.write();

            const token = getAuthToken('user', email);
            const res = await request(app)
                .get('/api/orders/search?q=')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(400);
        });
    });

    describe('POST /api/orders/:orderId/status', () => {
        it('should return 400 for invalid status', async () => {
            const orderId = 'order_1';
            db.data.orders[orderId] = { orderId, billingContact: { email: 'user@example.com' }, status: 'NEW' };
            await db.write();

            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken('admin', 'admin@example.com');

            const res = await agent
                .post(`/api/orders/${orderId}/status`)
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .send({ status: 'INVALID_STATUS_XYZ' });

            expect(res.statusCode).toBe(400);
        });
    });

    describe('POST /api/orders/:orderId/tracking', () => {
        it('should return 400 for empty courier', async () => {
            const orderId = 'order_2';
            db.data.orders[orderId] = { orderId, billingContact: { email: 'user@example.com' }, status: 'SHIPPED' };
            await db.write();

            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken('admin', 'admin@example.com');

            const res = await agent
                .post(`/api/orders/${orderId}/tracking`)
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .send({ trackingNumber: '123456', courier: '' });

            expect(res.statusCode).toBe(400);
        });
    });
});
