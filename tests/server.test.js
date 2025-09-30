import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import { startServer } from '../server/server.js';
import { initializeBot } from '../server/bot.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { getCurrentSigningKey } from '../server/keyManager.js';

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

    describe('/api/orders/search', () => {
        let userAuthToken;
        const userEmail = 'test@example.com';

        beforeEach(async () => {
            // Setup a user and their token
            const user = { id: 'user-1', email: userEmail, credentials: [] };
            db.data.users[user.id] = user;

            // Setup orders for the user
            db.data.orders.push(
                { orderId: 'abc-123', billingContact: { email: userEmail } },
                { orderId: 'def-456', billingContact: { email: userEmail } },
                { orderId: 'ghi-789', billingContact: { email: 'another@example.com' } }
            );
            await db.write();

            // Generate a token for the user
            const { privateKey, kid } = getCurrentSigningKey();
            userAuthToken = jwt.sign({ email: userEmail }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
        });

        it('should return all user orders when no query is provided', async () => {
            const res = await request(app)
                .get('/api/orders/search')
                .set('Authorization', `Bearer ${userAuthToken}`);

            expect(res.statusCode).toEqual(200);
            expect(res.body).toBeInstanceOf(Array);
            expect(res.body.length).toEqual(2);
            expect(res.body.some(order => order.orderId === 'abc-123')).toBe(true);
            expect(res.body.some(order => order.orderId === 'def-456')).toBe(true);
        });

        it('should return filtered user orders when a query is provided', async () => {
            const res = await request(app)
                .get('/api/orders/search?q=abc')
                .set('Authorization', `Bearer ${userAuthToken}`);

            expect(res.statusCode).toEqual(200);
            expect(res.body).toBeInstanceOf(Array);
            expect(res.body.length).toEqual(1);
            expect(res.body[0].orderId).toEqual('abc-123');
        });

        it('should return a 200 with an empty array if search query matches no orders', async () => {
            const res = await request(app)
                .get('/api/orders/search?q=xyz')
                .set('Authorization', `Bearer ${userAuthToken}`);

            expect(res.statusCode).toEqual(200);
            expect(res.body).toEqual([]);
        });
    });
});
