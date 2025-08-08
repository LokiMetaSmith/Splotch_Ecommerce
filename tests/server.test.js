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
    let tokenRotationTimer;
    const testDbPath = path.join(__dirname, 'test-db.json');

    beforeAll(async () => {
        // Create a single db instance for the test suite
        db = await JSONFilePreset(testDbPath, { orders: [], users: {}, credentials: {}, config: {} });
        bot = initializeBot(db);
        // Create a mock sendEmail function
        const mockSendEmail = jest.fn();
        // Initialize the app with the test database instance and mock emailer
        const server = await startServer(db, bot, mockSendEmail, testDbPath);
        app = server.app;
        tokenRotationTimer = server.tokenRotationTimer;
    });

    beforeEach(async () => {
        // Reset the test database state before each test
        db.data = { orders: [], users: {}, credentials: {}, config: {} };
        await db.write();
    });

    afterAll(async () => {
        clearInterval(tokenRotationTimer);
        try {
            // Use fs.unlinkSync as we are in a sync-like afterAll hook and need to ensure cleanup.
            // Using the callback version can be tricky with async/await.
            if (fs.existsSync(testDbPath)) {
                fs.unlinkSync(testDbPath);
            }
        } catch (error) {
            // This block is primarily for safety, though existsSync should prevent ENOENT.
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    });

    it('should respond to ping', async () => {
        const res = await request(app).get('/api/ping');
        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toEqual('ok');
    });
});
