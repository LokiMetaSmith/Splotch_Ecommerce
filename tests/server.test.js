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
        // db will be initialized by startServer, but we need the bot before that.
        // For the purpose of the test, we can create a temporary db instance for the bot.
        const tempDb = await JSONFilePreset(testDbPath, { orders: [], users: {}, credentials: {}, config: {} });
        bot = initializeBot(tempDb);
        const mockSendEmail = jest.fn();
        const server = await startServer(bot, mockSendEmail, testDbPath);
        app = server.app;
        timers = server.timers;
        db = server.db; // Get the db instance from the server
        serverInstance = app.listen(); // Start the server
    });

    beforeEach(async () => {
        db.data = { orders: [], users: {}, credentials: {}, config: {} };
        await db.write();
    });

    afterAll(async () => {
        timers.forEach(timer => clearInterval(timer));
        // Stop the bot from polling
        if (bot && bot.isPolling()) {
            await bot.stopPolling();
        }
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
});
