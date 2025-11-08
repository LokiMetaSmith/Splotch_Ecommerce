import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import { startServer } from '../server/server.js';
import { initializeBot } from '../server/bot.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Server', () => {
    let app;
    let db;
    let bot;
    let serverInstance; // To hold the server instance for closing
    let timers; // To hold the timer for clearing
    const testDbPath = path.join(__dirname, 'test-db.json');

    beforeAll(async () => {
        db = await JSONFilePreset(testDbPath, { orders: [], users: {}, credentials: {}, config: {} });
        bot = initializeBot(db);
        const mockSendEmail = jest.fn();
        const server = await startServer(db, bot, mockSendEmail, testDbPath);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen(); // Start the server
    });

    beforeEach(async () => {
        db.data = { orders: [], users: {}, credentials: {}, config: {} };
        await db.write();
    });

    afterAll(async () => {
        // Stop the bot from polling, if it's running
        if (bot && typeof bot.isPolling === 'function' && bot.isPolling()) {
            await bot.stopPolling();
        }
        // Clear timers
        timers.forEach(timer => clearInterval(timer));
        // Close the server
        await new Promise(resolve => serverInstance.close(resolve));
        // Clean up the test database file
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    it('should respond to ping', async () => {
        const res = await request(app).get('/api/ping');
        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toEqual('ok');
    });

    it('should prevent a user from accessing another user\'s order (IDOR)', async () => {
        // 1. Create two users
        db.data.users['user1'] = { id: 'user1', email: 'user1@example.com' };
        db.data.users['user2'] = { id: 'user2', email: 'user2@example.com' };

        // 2. Create an order for each user
        const order1 = { orderId: 'order1', billingContact: { email: 'user1@example.com' } };
        const order2 = { orderId: 'order2', billingContact: { email: 'user2@example.com' } };
        db.data.orders.push(order1, order2);
        await db.write();

        // 3. Get a temporary auth token for user1
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const tokenRes = await agent
            .post('/api/auth/issue-temp-token')
            .set('x-csrf-token', csrfToken)
            .send({ email: 'user1@example.com' });
        const authToken = tokenRes.body.token;

        // 4. As user1, attempt to access order2
        const res = await agent
            .get('/api/orders/order2')
            .set('Authorization', `Bearer ${authToken}`);

        // 5. The server should return a 404 to prevent information leakage
        expect(res.statusCode).toEqual(404);
    });
});
