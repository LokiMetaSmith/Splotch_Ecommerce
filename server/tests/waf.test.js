// server/tests/waf.test.js
import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// Mock logger before importing the module under test
const loggerMock = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
};

await jest.unstable_mockModule('../logger.js', () => ({
    default: loggerMock,
}));

const { wafMiddleware } = await import('../waf.js');

describe('WAF Middleware', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json()); // To parse JSON body
        app.use(express.urlencoded({ extended: true })); // To parse URL-encoded body

        // Apply WAF middleware
        app.use(wafMiddleware);

        // Dummy routes
        app.post('/test', (req, res) => {
            res.status(200).json({ success: true, received: req.body });
        });
        app.get('/test', (req, res) => {
            res.status(200).json({ success: true, query: req.query });
        });
        app.get('/test/:id', (req, res) => {
            res.status(200).json({ success: true, params: req.params });
        });
    });

    afterEach(() => {
        loggerMock.warn.mockClear();
    });

    describe('Benign Requests', () => {
        test('should allow safe JSON body', async () => {
            const res = await request(app)
                .post('/test')
                .send({ name: 'John Doe', description: 'Just a normal user.' });
            expect(res.statusCode).toBe(200);
        });

        test('should allow safe query parameters', async () => {
            const res = await request(app)
                .get('/test?q=search&page=1');
            expect(res.statusCode).toBe(200);
        });

        test('should allow safe URL parameters', async () => {
            const res = await request(app)
                .get('/test/12345');
            expect(res.statusCode).toBe(200);
        });

        test('should allow benign special characters like single quotes in names', async () => {
            const res = await request(app)
                .post('/test')
                .send({ name: "O'Connor", desc: "It's a nice day" });
            expect(res.statusCode).toBe(200);
        });

        test('should allow benign sentences containing SQL keywords', async () => {
             const res = await request(app)
                .post('/test')
                .send({ message: "Please select an item from the list." });
            expect(res.statusCode).toBe(200);
        });
    });

    describe('SQL Injection Protection', () => {
        test('should block attacks in URL path', async () => {
             // encodeURIComponent("admin' OR 1=1") -> admin'%20OR%201%3D1
             // req.path decodes it.
             const res = await request(app)
                .get("/test/admin'%20OR%201=1");
            expect(res.statusCode).toBe(403);
            expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('SQL Injection'));
        });
        test('should block UNION SELECT', async () => {
            const res = await request(app)
                .post('/test')
                .send({ query: "UNION SELECT * FROM users" });
            expect(res.statusCode).toBe(403);
            expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('SQL Injection'));
        });

        test('should block OR 1=1', async () => {
            const res = await request(app)
                .post('/test')
                .send({ query: "admin' OR 1=1" });
            expect(res.statusCode).toBe(403);
            expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('SQL Injection'));
        });

        test('should block comment style attacks', async () => {
             const res = await request(app)
                .post('/test')
                .send({ query: "admin -- " });
            expect(res.statusCode).toBe(403);
            expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('SQL Injection'));
        });

        test('should block DROP TABLE', async () => {
             const res = await request(app)
                .post('/test')
                .send({ query: "; DROP TABLE users" });
            expect(res.statusCode).toBe(403);
            expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('SQL Injection'));
        });
    });

    describe('NoSQL Injection Protection', () => {
        test('should block keys starting with $ in body', async () => {
            const res = await request(app)
                .post('/test')
                .send({ username: { $ne: null } });
            expect(res.statusCode).toBe(403);
            expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('NoSQL Injection'));
        });

        test('should block nested keys starting with $', async () => {
            const res = await request(app)
                .post('/test')
                .send({ filter: { user: { $gt: 5 } } });
            expect(res.statusCode).toBe(403);
        });

        test('should allow benign strings that look like NoSQL keys but are values', async () => {
            // This case might trigger the fast-path regex (false positive),
            // but the slow path should correctly identify it as safe.
            const res = await request(app)
                .post('/test')
                .send({ msg: 'Say "$hi":' });
            expect(res.statusCode).toBe(200);
        });

        test('should allow benign keys that contain $ but do not start with it', async () => {
            const res = await request(app)
                .post('/test')
                .send({ "price$": 100 });
            expect(res.statusCode).toBe(200);
        });
    });

    describe('XSS Protection', () => {
        test('should block <script> tags', async () => {
            const res = await request(app)
                .post('/test')
                .send({ comment: "<script>alert(1)</script>" });
            expect(res.statusCode).toBe(403);
            expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('XSS'));
        });

        test('should block javascript: protocol', async () => {
            const res = await request(app)
                .post('/test')
                .send({ link: "javascript:alert(1)" });
            expect(res.statusCode).toBe(403);
        });

        test('should block event handlers', async () => {
            const res = await request(app)
                .post('/test')
                .send({ content: "<img src=x onerror=alert(1)>" });
            expect(res.statusCode).toBe(403);
        });
    });

    describe('Path Traversal Protection', () => {
        test('should block ../', async () => {
            const res = await request(app)
                .get('/test?file=../../etc/passwd');
            expect(res.statusCode).toBe(403);
            expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('Path Traversal'));
        });

        test('should block encoded ..%2F', async () => {
            const res = await request(app)
                .get('/test?file=..%2F..%2Fetc%2Fpasswd');
            expect(res.statusCode).toBe(403);
        });
    });
});
