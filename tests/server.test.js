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

    it('should return a CSRF token', async () => {
        const res = await request(app).get('/api/csrf-token');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('csrfToken');
        expect(typeof res.body.csrfToken).toBe('string');
    });

    it('should return pricing info', async () => {
        const res = await request(app).get('/api/pricing-info');
        expect(res.statusCode).toEqual(200);
        // We expect the body to be the pricing config object.
        // Checking for a few key properties to ensure it's the right object.
        expect(res.body).toHaveProperty('pricePerSquareInchCents');
        expect(res.body).toHaveProperty('resolutions');
        expect(res.body).toHaveProperty('materials');
    });

    it('should return server info with session token', async () => {
        const res = await request(app).get('/api/server-info');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('serverSessionToken');
        expect(typeof res.body.serverSessionToken).toBe('string');
    });
});
