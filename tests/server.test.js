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
        db = await JSONFilePreset(testDbPath, { orders: [], users: {}, credentials: {}, config: {} });
        bot = initializeBot(db);
        const server = await startServer(db, bot, testDbPath);
        app = server.app;
        tokenRotationTimer = server.tokenRotationTimer;
    });

    afterAll(async () => {
        clearInterval(tokenRotationTimer);
        await fs.promises.unlink(testDbPath);
    });

    it('should respond to ping', async () => {
        const res = await request(app).get('/api/ping');
        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toEqual('ok');
    });
});
