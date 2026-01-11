import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock file-type before importing server
jest.unstable_mockModule('file-type', () => ({
    fileTypeFromFile: jest.fn().mockImplementation(async (filePath) => {
        if (filePath.endsWith('.svg')) {
            return { mime: 'image/svg+xml', ext: 'svg' };
        }
        return { mime: 'image/png', ext: 'png' };
    }),
}));

describe('SVG Sanitization', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, 'test-db-svg.json');
    let authToken;
    let agent;
    let csrfToken;
    let startServer;
    let initializeBot;
    let getCurrentSigningKey;

    beforeAll(async () => {
        const serverModule = await import('../server/server.js');
        startServer = serverModule.startServer;
        const botModule = await import('../server/bot.js');
        initializeBot = botModule.initializeBot;
        const keyManagerModule = await import('../server/keyManager.js');
        getCurrentSigningKey = keyManagerModule.getCurrentSigningKey;

        db = await JSONFilePreset(testDbPath, { orders: [], users: {}, credentials: {}, config: {} });
        bot = initializeBot(db);
        const mockSendEmail = jest.fn();
        const server = await startServer(db, bot, mockSendEmail, testDbPath);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen();
        agent = request.agent(app);

        // Fetch CSRF Token
        const csrfRes = await agent.get('/api/csrf-token');
        csrfToken = csrfRes.body.csrfToken;

        // Create a valid token
        const { privateKey, kid } = getCurrentSigningKey();
        authToken = jwt.sign(
            { username: 'testuser', email: 'test@example.com' },
            privateKey,
            { algorithm: 'RS256', expiresIn: '1h', header: { kid } }
        );
    }, 30000);

    beforeEach(async () => {
        db.data = { orders: [], users: {}, credentials: {}, config: {} };
        await db.write();
    });

    afterAll(async () => {
        if (bot && typeof bot.isPolling === 'function' && bot.isPolling()) {
            await bot.stopPolling();
        }
        if (timers) timers.forEach(timer => clearInterval(timer));
        if (serverInstance) await new Promise(resolve => serverInstance.close(resolve));
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    it('should accept a valid SVG file', async () => {
        const validSvgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" /></svg>';
        const validSvgPath = path.join(__dirname, 'valid.svg');
        fs.writeFileSync(validSvgPath, validSvgContent);

        const res = await agent
            .post('/api/upload-design')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .attach('designImage', validSvgPath);

        fs.unlinkSync(validSvgPath);

        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
        expect(res.body.designImagePath).toBeDefined();

        // Fix path resolution: designImagePath is like /uploads/filename
        const uploadedPath = path.join(__dirname, '../server', res.body.designImagePath.substring(1));

        expect(fs.existsSync(uploadedPath)).toBe(true);
        const content = fs.readFileSync(uploadedPath, 'utf8');
        expect(content).toContain('<circle');

        if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
    });

    it('should reject a purely malicious SVG file (empty after sanitization)', async () => {
        // If DOMPurify strips everything, it should be rejected.
        // Note: DOMPurify might leave <svg> tags.
        // If I put content that is NOT a tag, it might stay?
        // Let's try only script.
        const maliciousSvgContent = '<script>alert("xss")</script>';
        const maliciousSvgPath = path.join(__dirname, 'malicious.svg');
        fs.writeFileSync(maliciousSvgPath, maliciousSvgContent);

        const res = await agent
            .post('/api/upload-design')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .attach('designImage', maliciousSvgPath);

        fs.unlinkSync(maliciousSvgPath);

        // If it becomes empty string, it should be rejected with 400
        expect(res.statusCode).toEqual(400);
        expect(res.body.error).toContain('rejected');
    });

    it('should sanitize an SVG file with mixed content (remove script, keep safe)', async () => {
        const mixedSvgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert("xss")</script><circle cx="50" cy="50" r="40" /></svg>';
        const mixedSvgPath = path.join(__dirname, 'mixed.svg');
        fs.writeFileSync(mixedSvgPath, mixedSvgContent);

        const res = await agent
            .post('/api/upload-design')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .attach('designImage', mixedSvgPath);

        fs.unlinkSync(mixedSvgPath);

        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);

        const uploadedPath = path.join(__dirname, '../server', res.body.designImagePath.substring(1));
        expect(fs.existsSync(uploadedPath)).toBe(true);
        const content = fs.readFileSync(uploadedPath, 'utf8');
        expect(content).not.toContain('<script');
        expect(content).toContain('<circle');

        if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
    });
});
