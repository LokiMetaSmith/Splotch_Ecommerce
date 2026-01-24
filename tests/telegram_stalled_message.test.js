import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import { startServer } from '../server/server.js';
import { initializeBot } from '../server/bot.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Telegram Stalled Message Deletion', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, 'test-db-telegram.json');
    let adminToken;

    beforeAll(async () => {
        process.env.TELEGRAM_BOT_TOKEN = 'mock-token';
        process.env.TELEGRAM_CHANNEL_ID = 'mock-channel';

        // Setup clean DB
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        db = await JSONFilePreset(testDbPath, { orders: {}, users: {}, credentials: {}, config: {} });

        // Initialize bot and mock deleteMessage
        bot = initializeBot(db);
        bot.telegram.deleteMessage = jest.fn().mockResolvedValue(true);
        bot.telegram.editMessageText = jest.fn().mockResolvedValue(true);
        bot.telegram.sendMessage = jest.fn().mockResolvedValue({ message_id: 123 });

        const mockSendEmail = jest.fn();
        const server = await startServer(db, bot, mockSendEmail, testDbPath);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen();

    });

    afterAll(async () => {
        if (timers) timers.forEach(timer => clearInterval(timer));
        if (serverInstance) await new Promise(resolve => serverInstance.close(resolve));
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    it('should delete the stalled message when status is updated', async () => {
        const agent = request.agent(app);

        // 0. Get CSRF Token
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;

        // 1. Register a user
        const regRes = await agent
            .post('/api/auth/register-user')
            .set('X-CSRF-Token', csrfToken)
            .send({ username: 'admin', password: 'password123' });
        if (regRes.statusCode !== 200) console.error('Reg failed:', regRes.body);
        expect(regRes.statusCode).toBe(200);

        // 2. Elevate to admin in DB
        await db.read(); // Ensure we have latest data
        const user = db.data.users['admin'];
        user.role = 'admin';
        // Add email manually as register-user doesn't require it but isAdmin checks it or username
        user.email = 'admin@example.com';
        if (!db.data.emailIndex) db.data.emailIndex = {};
        db.data.emailIndex['admin@example.com'] = 'admin';
        await db.write();

        // 3. Login to get token
        const loginRes = await agent
            .post('/api/auth/login')
            .set('X-CSRF-Token', csrfToken)
            .send({ username: 'admin', password: 'password123' });

        expect(loginRes.statusCode).toBe(200);
        adminToken = loginRes.body.token;

        // Create an order with stalledMessageId
        const orderId = 'test-order-stalled';
        const order = {
            orderId: orderId,
            status: 'NEW',
            amount: 1000,
            currency: 'USD',
            billingContact: { email: 'test@example.com', givenName: 'Test', familyName: 'User' },
            stalledMessageId: 9999,
            telegramMessageId: 8888,
            receivedAt: new Date().toISOString()
        };
        db.data.orders[orderId] = order;
        await db.write();

        // Call status update endpoint
        const res = await agent
            .post(`/api/orders/${orderId}/status`)
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({ status: 'ACCEPTED' });

        if (res.statusCode !== 200) {
            console.error('Response body:', res.body);
        }
        expect(res.statusCode).toEqual(200);

        // Verify deleteMessage was called with the correct ID
        expect(bot.telegram.deleteMessage).toHaveBeenCalledWith(expect.anything(), 9999);

        // Verify stalledMessageId is removed from DB
        const updatedOrder = db.data.orders[orderId];
        expect(updatedOrder.stalledMessageId).toBeUndefined();
    });
});
