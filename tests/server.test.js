import { jest } from '@jest/globals';
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
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, 'test-db.json');

    beforeAll(async () => {
        db = await JSONFilePreset(testDbPath, { orders: [], users: {}, credentials: {}, config: {} });
        bot = initializeBot(db);
        const mockSendEmail = jest.fn();
        const serverResult = await startServer(db, bot, mockSendEmail, testDbPath);
        app = serverResult.app;
        timers = serverResult.timers;
        serverInstance = app.listen();
    });

    beforeEach(async () => {
        db.data = { orders: [], users: {}, credentials: {}, config: {} };
        await db.write();
    });

    afterAll((done) => {
        // Clear all timers
        timers.forEach(clearInterval);
        // Stop the bot from polling
        if (bot && typeof bot.isPolling === 'function' && bot.isPolling()) {
            bot.stopPolling();
        }
        // Close the server
        serverInstance.close(() => {
            if (fs.existsSync(testDbPath)) {
                fs.unlinkSync(testDbPath);
            }
            done();
        });
    });

    it('should respond to ping', async () => {
        const res = await request(app).get('/api/ping');
        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toEqual('ok');
    });
});
