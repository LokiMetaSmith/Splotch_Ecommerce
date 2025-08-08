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
        // Use fs.unlink, not fs.promises.unlink, to match the import
        await fs.unlink(testDbPath, () => {});
    });

    it('should respond to ping', async () => {
        const res = await request(app).get('/api/ping');
        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toEqual('ok');
    });
});
