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

    it('should include a Content-Security-Policy-Report-Only header', async () => {
        const res = await request(app).get('/api/ping');
        expect(res.headers['content-security-policy-report-only']).toBeDefined();
        const csp = res.headers['content-security-policy-report-only'];
        const policies = csp.split(';').map(p => p.trim());
        expect(policies).toContain("default-src 'self'");
        expect(policies).toContain("script-src 'self',https://cdn.jsdelivr.net,https://sandbox.web.squarecdn.com");
        expect(policies).toContain("style-src 'self','unsafe-inline',https://fonts.googleapis.com");
        expect(policies).toContain("font-src 'self',https://fonts.gstatic.com");
    });
});
