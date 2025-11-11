
import request from 'supertest';
import { startServer } from '../server/server.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import speakeasy from 'speakeasy';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { getCurrentSigningKey } from '../server/keyManager.js';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock the keyManager to use a consistent key for JWT signing in tests
jest.mock('../server/keyManager.js', () => ({
    getCurrentSigningKey: () => ({ privateKey: 'test-private-key', publicKey: 'test-public-key', kid: 'test-kid' }),
    getJwks: () => ({ keys: [] }),
    rotateKeys: () => Promise.resolve(),
}));


describe('MFA (TOTP) Endpoints', () => {
    let app;
    let server;
    let dbPath;
    let timers;
    let adminToken;
    let adminUser;
    let db;

    beforeAll(async () => {
        dbPath = path.join(__dirname, 'test-db-mfa.json');
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

        const serverInstance = await startServer(null, null, null, dbPath);
        app = serverInstance.app;
        timers = serverInstance.timers;
        server = app.listen(0);
        db = serverInstance.db;


        // Manually create an admin user and add to DB for testing
        const hashedPassword = await bcrypt.hash('password123', 10);
        adminUser = {
            id: 'admin-user-id',
            username: 'admin',
            email: process.env.ADMIN_EMAIL,
            password: hashedPassword,
            mfa_enabled: false,
            mfa_secret: ''
        };
        db.data.users['admin'] = adminUser;
        await db.write();

        // This simulates the admin user being logged in
        const { privateKey, kid } = getCurrentSigningKey();
        adminToken = jwt.sign(
            { email: adminUser.email },
            privateKey,
            { algorithm: 'RS256', expiresIn: '1h', header: { kid } }
        );
    });

    afterAll((done) => {
        timers.forEach(timer => clearInterval(timer));
        server.close(() => {
            if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
            done();
        });
    });

    it('should allow an admin to set up MFA and get a QR code', async () => {
        const response = await request(app)
            .post('/api/auth/mfa/setup')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.secret).toBeDefined();
        expect(response.body.qrCodeUrl).toBeDefined();

        // Check that the secret was stored in the db
        await db.read();
        expect(db.data.users['admin'].mfa_secret).toBe(response.body.secret);
    });

    it('should allow an admin to verify and enable MFA with a valid token', async () => {
        // First, set up MFA to get a secret
        const setupResponse = await request(app)
            .post('/api/auth/mfa/setup')
            .set('Authorization', `Bearer ${adminToken}`);

        const secret = setupResponse.body.secret;
        const token = speakeasy.totp({
            secret: secret,
            encoding: 'base32'
        });

        // Now, verify the token to enable MFA
        const verifyResponse = await request(app)
            .post('/api/auth/mfa/verify')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ token });

        expect(verifyResponse.status).toBe(200);
        expect(verifyResponse.body.success).toBe(true);

        // Check that MFA is now enabled in the db
        await db.read();
        expect(db.data.users['admin'].mfa_enabled).toBe(true);
    });

    it('should require MFA for login when enabled', async () => {
        // 1. Setup and enable MFA for the admin user
        const setupResponse = await request(app)
            .post('/api/auth/mfa/setup')
            .set('Authorization', `Bearer ${adminToken}`);
        const secret = setupResponse.body.secret;
        const validToken = speakeasy.totp({ secret, encoding: 'base32' });
        await request(app)
            .post('/api/auth/mfa/verify')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ token: validToken });

        // 2. Attempt to login with password only
        const loginResponse1 = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'password123' });

        expect(loginResponse1.status).toBe(202);
        expect(loginResponse1.body.mfaRequired).toBe(true);

        // 3. Attempt to login with password and an invalid MFA token
        const loginResponse2 = await request(app)
            .post('/api/auth/mfa/login')
            .send({ username: 'admin', token: 'invalidtoken' });

        expect(loginResponse2.status).toBe(401);
        expect(loginResponse2.body.error).toBe('Invalid MFA token.');

        // 4. Complete login with password and a valid MFA token
        const correctToken = speakeasy.totp({ secret, encoding: 'base32' });
        const loginResponse3 = await request(app)
            .post('/api/auth/mfa/login')
            .send({ username: 'admin', token: correctToken });

        expect(loginResponse3.status).toBe(200);
        expect(loginResponse3.body.token).toBeDefined();
    });
});
