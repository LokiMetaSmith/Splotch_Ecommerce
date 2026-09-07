import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Chunked Upload API', () => {
    let app;
    let db;
    let serverClose;
    let agent;
    let authToken;
    let csrfToken;
    const testDbPath = path.join(__dirname, 'test-db-chunked.json');

    const mockSquareClient = {
        locations: {},
        payments: {
            create: jest.fn().mockResolvedValue({
                payment: { id: 'mock_payment_id', orderId: 'mock_square_order_id' }
            })
        }
    };

    beforeAll(async () => {
        const data = { orders: {}, batches: {}, users: {}, credentials: {}, config: {}, products: {} };
        db = {
            data: data,
            write: async () => {},
            read: async () => {},
            getUser: async (username) => Object.values(data.users).find(u => u.username === username),
            getUserByEmail: async (email) => Object.values(data.users).find(u => u.email === email),
            createUser: async (user) => { data.users[user.id] = user; return user; },
            updateUser: async (user) => { data.users[user.id] = user; return user; },
            getConfig: async () => data.config,
            setConfig: async (k, v) => { data.config[k] = v; },
        };

        const server = await startServer(db, null, jest.fn(), testDbPath, mockSquareClient);
        app = server.app;
        serverClose = server.close;

        agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        csrfToken = csrfRes.body.csrfToken;

        await agent
            .post('/api/auth/register-user')
            .set('X-CSRF-Token', csrfToken)
            .send({ username: 'chunkuser', password: 'password123' });

        const loginCsrf = await agent.get('/api/csrf-token');
        csrfToken = loginCsrf.body.csrfToken;

        const loginRes = await agent
            .post('/api/auth/login')
            .set('X-CSRF-Token', csrfToken)
            .send({ username: 'chunkuser', password: 'password123' });

        authToken = loginRes.body.token;

        const tokenRes = await agent.get('/api/csrf-token');
        csrfToken = tokenRes.body.csrfToken;
    });

    afterAll(async () => {
        if (serverClose) await serverClose();
        try { await fs.unlink(testDbPath); } catch (e) {}
    });

    it('should reject init with unsupported file extension', async () => {
        const res = await agent
            .post('/api/upload-chunk/init')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({
                filename: 'malicious.exe',
                totalSize: 1024,
                totalChunks: 1,
                mimeType: 'application/x-msdownload'
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Unsupported file extension');
    });

    it('should reject init with invalid total size or chunks count', async () => {
        const res = await agent
            .post('/api/upload-chunk/init')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({
                filename: 'image.png',
                totalSize: -50,
                totalChunks: 0,
                mimeType: 'image/png'
            });

        expect(res.status).toBe(400);
    });

    it('should successfully upload and reassemble chunks into a valid PNG file', async () => {
        // Create a 1x1 valid PNG buffer
        const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const pngBuffer = Buffer.from(samplePngBase64, 'base64');
        const chunkSize = 20;
        const totalChunks = Math.ceil(pngBuffer.length / chunkSize);
        const uploadId = crypto.randomUUID();

        // 1. Init
        const initRes = await agent
            .post('/api/upload-chunk/init')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({
                uploadId,
                filename: 'artwork.png',
                totalSize: pngBuffer.length,
                totalChunks,
                mimeType: 'image/png'
            });

        expect(initRes.status).toBe(200);
        expect(initRes.body.uploadId).toBe(uploadId);

        // 2. Upload chunks (simulate out-of-order arrival)
        const chunkIndices = Array.from({ length: totalChunks }, (_, i) => i).reverse();
        for (const index of chunkIndices) {
            const start = index * chunkSize;
            const end = Math.min(start + chunkSize, pngBuffer.length);
            const chunkSlice = pngBuffer.subarray(start, end);

            const chunkRes = await agent
                .post('/api/upload-chunk')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-CSRF-Token', csrfToken)
                .field('uploadId', uploadId)
                .field('chunkIndex', index)
                .attach('chunk', chunkSlice, `chunk_${index}`);

            expect(chunkRes.status).toBe(200);
            expect(chunkRes.body.receivedChunks).toBeGreaterThan(0);
        }

        // 3. Complete
        const completeRes = await agent
            .post('/api/upload-chunk/complete')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({ uploadId });

        expect(completeRes.status).toBe(200);
        expect(completeRes.body.success).toBe(true);
        expect(completeRes.body.filePath).toMatch(/^\/uploads\/designImage-.*\.png$/);
    });

    it('should reject complete if chunks are missing', async () => {
        const uploadId = crypto.randomUUID();

        // Init with 3 chunks
        await agent
            .post('/api/upload-chunk/init')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({
                uploadId,
                filename: 'design.png',
                totalSize: 300,
                totalChunks: 3,
                mimeType: 'image/png'
            });

        // Only upload chunk 0
        await agent
            .post('/api/upload-chunk')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .field('uploadId', uploadId)
            .field('chunkIndex', 0)
            .attach('chunk', Buffer.from('chunk0data'), 'part0');

        // Try to complete
        const res = await agent
            .post('/api/upload-chunk/complete')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({ uploadId });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Upload incomplete');
    });

    it('should allow aborting an in-progress chunked session', async () => {
        const uploadId = crypto.randomUUID();

        await agent
            .post('/api/upload-chunk/init')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({
                uploadId,
                filename: 'cancelme.png',
                totalSize: 500,
                totalChunks: 2,
                mimeType: 'image/png'
            });

        const abortRes = await agent
            .post('/api/upload-chunk/abort')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({ uploadId });

        expect(abortRes.status).toBe(200);
        expect(abortRes.body.success).toBe(true);

        // Subsequent complete should 404
        const completeRes = await agent
            .post('/api/upload-chunk/complete')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({ uploadId });

        expect(completeRes.status).toBe(404);
    });

    it('should sanitize and validate SVG chunked cutline uploads', async () => {
        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" /></svg>`;
        const svgBuffer = Buffer.from(svgContent, 'utf-8');
        const uploadId = crypto.randomUUID();

        await agent
            .post('/api/upload-chunk/init')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({
                uploadId,
                filename: 'cutline.svg',
                totalSize: svgBuffer.length,
                totalChunks: 1,
                mimeType: 'image/svg+xml',
                isCutLine: true
            });

        await agent
            .post('/api/upload-chunk')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .field('uploadId', uploadId)
            .field('chunkIndex', 0)
            .attach('chunk', svgBuffer, 'cutline_part_0');

        const completeRes = await agent
            .post('/api/upload-chunk/complete')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({ uploadId });

        expect(completeRes.status).toBe(200);
        expect(completeRes.body.success).toBe(true);
        expect(completeRes.body.isCutLine).toBe(true);
        expect(completeRes.body.filePath).toMatch(/^\/uploads\/cutLineFile-.*\.svg$/);
    });
});
