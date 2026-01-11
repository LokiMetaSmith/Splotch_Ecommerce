import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { JSONFilePreset } from 'lowdb/node';

// Import modules
import { startServer } from '../server/server.js';
import { getCurrentSigningKey } from '../server/keyManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security: Prototype Pollution Prevention', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, '../server/test-db-security-proto.json');
    let mockSquareClient;
    let mockSendEmail;

    beforeAll(async () => {
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }

        db = await JSONFilePreset(testDbPath, { orders: {}, users: {}, credentials: {}, config: {}, products: {} });

        bot = { telegram: { sendMessage: jest.fn() } };
        mockSendEmail = jest.fn().mockResolvedValue(true);
        mockSquareClient = { locations: { list: jest.fn() }, payments: { create: jest.fn() } };

        process.env.ADMIN_EMAIL = 'admin@example.com';
        process.env.NODE_ENV = 'test';
        process.env.SESSION_SECRET = 'test-secret'; // Required for server startup

        const server = await startServer(db, bot, mockSendEmail, testDbPath, mockSquareClient);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen();
    });

    beforeEach(async () => {
        db.data.orders = {};
        db.data.users = {};
        db.data.emailIndex = {}; // IMPORTANT: Reset email index too!
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

    it('should block prototype pollution attempts on GET /api/orders/:orderId', async () => {
        const token = getAuthToken();
        const res = await request(app)
            .get('/api/orders/__proto__')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(400);
        expect(res.body.errors[0].msg).toBe('Invalid ID');
    });

    it('should block prototype pollution attempts on GET /api/orders/constructor', async () => {
        const token = getAuthToken();
        const res = await request(app)
            .get('/api/orders/constructor')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(400);
        expect(res.body.errors[0].msg).toBe('Invalid ID');
    });

     it('should block prototype pollution attempts on GET /api/orders/prototype', async () => {
        const token = getAuthToken();
        const res = await request(app)
            .get('/api/orders/prototype')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(400);
        expect(res.body.errors[0].msg).toBe('Invalid ID');
    });

    it('should block prototype pollution attempts on POST /api/orders/:orderId/status', async () => {
        // We need to use a token that would otherwise be authorized to access this endpoint
        // to ensure it's the validation middleware blocking it, not the auth/RBAC middleware.
        const token = getAuthToken('admin', 'admin@example.com');

        // Seed the user so RBAC checks (isAdmin) pass
        db.data.users['admin'] = {
            id: 'admin-id',
            username: 'admin',
            email: 'admin@example.com',
            role: 'admin'
        };
        db.data.emailIndex['admin@example.com'] = 'admin';
        await db.write();

        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;

        const res = await agent
            .post('/api/orders/__proto__/status')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrfToken)
            .send({ status: 'SHIPPED' });

        expect(res.statusCode).toBe(400);
        expect(res.body.errors[0].msg).toBe('Invalid ID');
    });

    it('should block prototype pollution attempts on POST /api/orders/:orderId/tracking', async () => {
         // We need to use a token that would otherwise be authorized to access this endpoint
        // to ensure it's the validation middleware blocking it, not the auth/RBAC middleware.
        const token = getAuthToken('admin', 'admin@example.com');

        // Seed the user so RBAC checks (isAdmin) pass
        db.data.users['admin'] = {
            id: 'admin-id',
            username: 'admin',
            email: 'admin@example.com',
            role: 'admin'
        };
        db.data.emailIndex['admin@example.com'] = 'admin';
        await db.write();

        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;

        const res = await agent
            .post('/api/orders/__proto__/tracking')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrfToken)
            .send({ trackingNumber: '123', courier: 'UPS' });

        expect(res.statusCode).toBe(400);
        expect(res.body.errors[0].msg).toBe('Invalid ID');
    });
});
