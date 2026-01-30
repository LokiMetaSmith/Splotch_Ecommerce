import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { JSONFilePreset } from 'lowdb/node';

// Import modules
import { startServer } from '../server/server.js';
import { getCurrentSigningKey } from '../server/keyManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Upload API Endpoints', () => {
    let app;
    let db;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, '../server/test-db-upload.json');
    const uploadsDir = path.join(__dirname, '../server/uploads');
    let mockSquareClient;
    let uploadedFiles = [];

    beforeAll(async () => {
        // Ensure clean DB start
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }

        // Setup mock DB
        db = await JSONFilePreset(testDbPath, { orders: {}, users: {}, credentials: {}, config: {} });

        // Mock Bot (minimal)
        const bot = {
            telegram: {
                sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
            },
            stopPolling: jest.fn()
        };

        // Mock SendEmail
        const mockSendEmail = jest.fn().mockResolvedValue(true);

        // Mock Square Client (minimal)
        mockSquareClient = {
            locations: { list: jest.fn() },
            payments: { create: jest.fn() }
        };

        // Set Env Vars
        process.env.NODE_ENV = 'test';
        process.env.SESSION_SECRET = 'test-secret'; // Ensure session secret is set

        // Start Server
        const server = await startServer(db, bot, mockSendEmail, testDbPath, mockSquareClient);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen();
    });

    afterAll(async () => {
        if (timers) timers.forEach(timer => clearInterval(timer));
        if (serverInstance) await new Promise(resolve => serverInstance.close(resolve));
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }

        // Clean up uploaded files
        for (const file of uploadedFiles) {
            const filePath = path.join(uploadsDir, path.basename(file));
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
    });

    const getAuthToken = (username = 'testuser', email = 'test@example.com') => {
        const { privateKey, kid } = getCurrentSigningKey();
        return jwt.sign({ username, email }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    };

    describe('POST /api/upload-design', () => {
        it('should upload a PNG file successfully', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken();
            const faviconPath = path.join(__dirname, '../favicon.png');

            const res = await agent
                .post('/api/upload-design')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .attach('designImage', faviconPath);

            expect(res.statusCode).toEqual(200);
            expect(res.body.success).toBe(true);
            expect(res.body.designImagePath).toMatch(/^\/uploads\/.*\.png$/);

            uploadedFiles.push(res.body.designImagePath);

            // Verify file exists
            const savedPath = path.join(__dirname, '../server', res.body.designImagePath);
            expect(fs.existsSync(savedPath)).toBe(true);
        });

        it('should upload a valid SVG string successfully', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken();
            const svgContent = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect x="0" y="0" width="10" height="10"/></svg>';
            const buffer = Buffer.from(svgContent);

            const res = await agent
                .post('/api/upload-design')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .attach('designImage', buffer, 'test.svg');

            expect(res.statusCode).toEqual(200);
            expect(res.body.success).toBe(true);
            // File-type detects XML, so server renames to .xml. We accept both.
            expect(res.body.designImagePath).toMatch(/^\/uploads\/.*\.(svg|xml)$/);

            uploadedFiles.push(res.body.designImagePath);
        });

        it('should upload design and cutline successfully', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken();
            const faviconPath = path.join(__dirname, '../favicon.png');
            const svgContent = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5"/></svg>';
            const buffer = Buffer.from(svgContent);

            const res = await agent
                .post('/api/upload-design')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .attach('designImage', faviconPath)
                .attach('cutLineFile', buffer, 'cutline.svg');

            expect(res.statusCode).toEqual(200);
            expect(res.body.success).toBe(true);
            expect(res.body.designImagePath).toBeDefined();
            expect(res.body.cutLinePath).toBeDefined();

            uploadedFiles.push(res.body.designImagePath);
            uploadedFiles.push(res.body.cutLinePath);
        });

        it('should fail when no file is uploaded', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken();
            const res = await agent
                .post('/api/upload-design')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken);

            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toMatch(/No design image file uploaded/);
        });

        it('should fail with invalid file type', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken();
            const textContent = 'This is not an image';
            const buffer = Buffer.from(textContent);

            const res = await agent
                .post('/api/upload-design')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .attach('designImage', buffer, 'test.txt');

            expect(res.statusCode).toEqual(400);
            // Assuming the server returns generic invalid type error
             expect(res.body.error).toMatch(/Invalid file type/);
        });

        it('should sanitize malicious SVG (script only)', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken();
            const maliciousSvg = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>';
            const buffer = Buffer.from(maliciousSvg);

            const res = await agent
                .post('/api/upload-design')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .attach('designImage', buffer, 'malicious.svg');

            // The server sanitizes it to an empty SVG tag (which is safe), so it returns 200
            expect(res.statusCode).toEqual(200);
            expect(res.body.success).toBe(true);

            uploadedFiles.push(res.body.designImagePath);
             const savedPath = path.join(__dirname, '../server', res.body.designImagePath);
            const content = fs.readFileSync(savedPath, 'utf-8');
            expect(content).not.toContain('<script');
        });

        it('should sanitize mixed content SVG', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken();
            const mixedSvg = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect x="0" y="0" width="10" height="10"/><script>alert("xss")</script></svg>';
            const buffer = Buffer.from(mixedSvg);

            const res = await agent
                .post('/api/upload-design')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .attach('designImage', buffer, 'mixed.svg');

            expect(res.statusCode).toEqual(200);
            uploadedFiles.push(res.body.designImagePath);

            const savedPath = path.join(__dirname, '../server', res.body.designImagePath);
            const content = fs.readFileSync(savedPath, 'utf-8');

            expect(content).toContain('<rect');
            expect(content).not.toContain('<script');
        });

         it('should enforce correct extension', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken();
            const faviconPath = path.join(__dirname, '../favicon.png');

            // Upload png but name it .jpg
            const res = await agent
                .post('/api/upload-design')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .attach('designImage', faviconPath, { filename: 'wrongext.jpg', contentType: 'image/png' });

            expect(res.statusCode).toEqual(200);
            // Server should rename it back to .png
            expect(res.body.designImagePath).toMatch(/\.png$/);

            uploadedFiles.push(res.body.designImagePath);
        });
    });
});
