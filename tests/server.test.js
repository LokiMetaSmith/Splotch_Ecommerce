import { startServer } from '../server/server.js';
import { initializeBot } from '../server/bot.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Server', () => {
    let app;
    let db;
    let bot;

    beforeAll(async () => {
        const dbPath = path.join(__dirname, 'test-db.json');
        db = await JSONFilePreset(dbPath, { orders: [], users: {}, credentials: {}, config: {} });
        bot = initializeBot(db);
        app = await startServer(db, bot, dbPath);
    });

    it('should respond to ping', async () => {
        const res = await request(app).get('/api/ping');
        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toEqual('ok');
    });
});
