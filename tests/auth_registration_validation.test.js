import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import { JSONFilePreset } from 'lowdb/node';
import { startServer } from '../server/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Auth Registration Security Tests', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, 'test-db-auth-reg.json');

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
        process.env.SESSION_SECRET = 'test-secret';

        const server = await startServer(db, bot, mockSendEmail, testDbPath, mockSquareClient);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen();
    });

    beforeEach(async () => {
        db.data.users = {};
        db.data.emailIndex = {};
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

    it('should reject passwords shorter than 8 characters', async () => {
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;

        const res = await agent
            .post('/api/auth/register-user')
            .set('X-CSRF-Token', csrfToken)
            .send({
                username: 'weakuser',
                password: '123'
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.errors).toBeDefined();
        const passwordError = res.body.errors.find(e => e.path === 'password');
        expect(passwordError).toBeDefined();
        // We expect this message after our fix
        expect(passwordError.msg).toMatch(/at least 8 characters/);
    });

    it('should accept passwords with 8 or more characters', async () => {
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;

        const res = await agent
            .post('/api/auth/register-user')
            .set('X-CSRF-Token', csrfToken)
            .send({
                username: 'stronguser',
                password: 'password123'
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
    });
});
