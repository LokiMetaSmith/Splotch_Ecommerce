import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Command Injection in /api/convert-image', () => {
    let app;
    let timers;
    let closeServer;
    let testUploadDir;
    let csrfToken;
    let cookie;

    beforeAll(async () => {
        const serverInstance = await startServer();
        app = serverInstance.app;
        timers = serverInstance.timers;
        closeServer = serverInstance.close;
        testUploadDir = path.join(__dirname, '..', 'uploads');

        // Get CSRF token
        const res = await request(app).get('/api/csrf-token');
        csrfToken = res.body.csrfToken;
        cookie = res.headers['set-cookie'];
    });

    afterAll(async () => {
        if (closeServer) await closeServer();
        timers.forEach(clearInterval);
    });

    it('should be vulnerable to command injection if the path is not sanitized', async () => {
        const maliciousFileName = 'test"; touch command_injected; echo ".pdf';

        // Ensure malicious file name exists locally
        await fs.writeFile(maliciousFileName, 'dummy data');

        const response = await request(app)
            .post('/api/convert-image')
            .set('Cookie', cookie)
            .set('x-csrf-token', csrfToken)
            .attach('file', maliciousFileName);

        // Use proper jest assertions: expect that fs.access throws an error (ENOENT)
        await expect(fs.access('command_injected')).rejects.toThrow();

        // Clean up the dummy file
        try {
            await fs.unlink(maliciousFileName);
        } catch (e) {}
    });
});
