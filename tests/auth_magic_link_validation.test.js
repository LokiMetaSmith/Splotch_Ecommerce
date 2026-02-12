import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import { JSONFilePreset } from 'lowdb/node';
import { startServer } from '../server/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Auth Magic Link Input Validation', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, 'test-db-magic-link-val.json');

    beforeAll(async () => {
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        db = await JSONFilePreset(testDbPath, { orders: {}, users: {}, credentials: {}, config: {}, products: {} });

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
        // Need to set a session secret to avoid fatal error
        process.env.SESSION_SECRET = 'test-secret-12345678901234567890';

        const server = await startServer(db, bot, mockSendEmail, testDbPath, mockSquareClient);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen();
    });

    afterAll(async () => {
        if (timers) timers.forEach(timer => clearInterval(timer));
        if (serverInstance) await new Promise(resolve => serverInstance.close(resolve));
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    describe('POST /api/auth/verify-magic-link', () => {
        it('should return 400 for non-string token (object)', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;

            const res = await agent
                .post('/api/auth/verify-magic-link')
                .set('X-CSRF-Token', csrfToken)
                .send({ token: { foo: 'bar' } });

            expect(res.statusCode).toBe(400);
        });

        it('should return 400 for non-string token (number)', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;

            const res = await agent
                .post('/api/auth/verify-magic-link')
                .set('X-CSRF-Token', csrfToken)
                .send({ token: 12345 });

            expect(res.statusCode).toBe(400);
        });

        it('should return 400 for empty token', async () => {
             const agent = request.agent(app);
             const csrfRes = await agent.get('/api/csrf-token');
             const csrfToken = csrfRes.body.csrfToken;

             const res = await agent
                .post('/api/auth/verify-magic-link')
                .set('X-CSRF-Token', csrfToken)
                .send({ token: '' });

            expect(res.statusCode).toBe(400);
        });
    });
});
