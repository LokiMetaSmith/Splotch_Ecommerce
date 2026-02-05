import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import server dynamically
const { startServer } = await import('../server/server.js');
const { JSONFilePreset } = await import('lowdb/node');

describe('WebAuthn Endpoints', () => {
    let app;
    let db;
    let serverInstance;
    let timers;
    let bot;
    let mockSendEmail;
    const testDbPath = path.join(__dirname, 'webauthn-test-db.json');
    let mockWebAuthn;

    beforeAll(async () => {
        db = await JSONFilePreset(testDbPath, { orders: {}, users: {}, credentials: {}, config: {} });
        mockSendEmail = jest.fn();

        // Create Mocks for WebAuthn
        mockWebAuthn = {
            generateRegistrationOptions: jest.fn(),
            verifyRegistrationResponse: jest.fn(),
            generateAuthenticationOptions: jest.fn(),
            verifyAuthenticationResponse: jest.fn()
        };

        // Inject mockWebAuthn
        const server = await startServer(db, null, mockSendEmail, testDbPath, null, undefined, mockWebAuthn);
        app = server.app;
        timers = server.timers;
        bot = server.bot;
        serverInstance = app.listen();
    });

    beforeEach(async () => {
        db.data = { orders: {}, users: {}, credentials: {}, config: {} };
        await db.write();
        mockSendEmail.mockClear();
        jest.clearAllMocks();
    });

    afterAll(async () => {
        if (bot) {
            await bot.stop('test');
        }
        timers.forEach(timer => clearInterval(timer));
        await new Promise(resolve => serverInstance.close(resolve));
        try {
            await fs.unlink(testDbPath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    });

    it('should verify registration and store credential', async () => {
        const agent = request.agent(app);

        // 1. Get CSRF Token
        let csrfRes = await agent.get('/api/csrf-token');
        let csrfToken = csrfRes.body.csrfToken;

        // 2. Pre-register
        const username = 'webauthnuser';
        const testChallenge = 'test-challenge';
        mockWebAuthn.generateRegistrationOptions.mockResolvedValue({ challenge: testChallenge });

        await agent
            .post('/api/auth/pre-register')
            .set('X-CSRF-Token', csrfToken)
            .send({ username });

        // 3. Verify Registration
        mockWebAuthn.verifyRegistrationResponse.mockResolvedValue({
            verified: true,
            registrationInfo: { credentialID: 'cred-id-123', publicKey: 'some-key' }
        });

        // Refresh CSRF
        csrfRes = await agent.get('/api/csrf-token');
        csrfToken = csrfRes.body.csrfToken;

        const res = await agent
            .post(`/api/auth/register-verify?username=${username}`)
            .set('X-CSRF-Token', csrfToken)
            .send({
                id: 'Y3JlZC1pZC0xMjM', // Base64URL encoded 'cred-id-123'
                response: {}
            });

        expect(res.statusCode).toEqual(200);
        expect(res.body.verified).toBe(true);

        await db.read();
        const user = Object.values(db.data.users).find(u => u.username === username);
        expect(user.credentials).toHaveLength(1);
        expect(db.data.credentials['cred-id-123']).toBeDefined();
    });

    it('should verify login and return token', async () => {
        const agent = request.agent(app);
        const username = 'webauthnuser';
        const testChallenge = 'auth-challenge';

        // Setup User and Credential in DB
        db.data.users[username] = {
            id: 'uuid-1',
            username,
            credentials: [{ credentialID: 'cred-id-123' }],
            challenge: testChallenge
        };
        db.data.credentials['cred-id-123'] = { credentialID: 'cred-id-123' };
        await db.write();

        // 1. Get CSRF Token
        let csrfRes = await agent.get('/api/csrf-token');
        let csrfToken = csrfRes.body.csrfToken;

        // 2. Verify Login
        mockWebAuthn.verifyAuthenticationResponse.mockResolvedValue({ verified: true });

        const res = await agent
            .post(`/api/auth/login-verify?username=${username}`)
            .set('X-CSRF-Token', csrfToken)
            .send({
                id: 'cred-id-123',
                response: {}
            });

        expect(res.statusCode).toEqual(200);
        expect(res.body.verified).toBe(true);
        expect(res.body.token).toBeDefined();

        const decoded = jwt.decode(res.body.token);
        expect(decoded.username).toEqual(username);
    });
});
