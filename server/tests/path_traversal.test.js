
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs';
import { JSONFilePreset } from 'lowdb/node';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { getCurrentSigningKey } from '../keyManager.js';

// Mock dependencies
const mockDb = {
    data: {
        users: {
            'testadmin': {
                id: 'admin-id',
                username: 'testadmin',
                role: 'admin',
                email: 'admin@example.com',
                password: 'hashedpassword',
                credentials: []
            },
            'testuser': {
                id: 'user-id',
                username: 'testuser',
                email: 'user@example.com',
                password: 'hashedpassword',
                credentials: []
            }
        },
        orders: {},
        emailIndex: {
            'admin@example.com': 'testadmin',
            'user@example.com': 'testuser'
        },
        config: {},
        products: {}
    },
    write: jest.fn(),
    read: jest.fn()
};

const mockBot = {
    telegram: {
        sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
        sendPhoto: jest.fn().mockResolvedValue({ message_id: 124 }),
        sendDocument: jest.fn().mockResolvedValue({ message_id: 125 })
    }
};

const mockSquareClient = {
    payments: {
        create: jest.fn().mockResolvedValue({
            payment: {
                id: 'payment-id',
                orderId: 'square-order-id',
                status: 'COMPLETED'
            }
        })
    },
    locations: {},
};

const mockSendEmail = jest.fn();

// Mock console.log/error to keep test output clean
// global.console = { ...global.console, log: jest.fn(), error: jest.fn(), warn: jest.fn() };


describe('Path Traversal Vulnerability', () => {
    let app;
    let server;
    let adminToken;
    let userToken;

    beforeAll(async () => {
        const serverInstance = await startServer(
            mockDb,
            mockBot,
            mockSendEmail,
            'test-db.json',
            mockSquareClient
        );
        app = serverInstance.app;

        // Login as user to get token
        const userRes = await request(app)
            .post('/api/auth/login')
            .send({ username: 'testuser', password: 'password123' }); // We can't really login without real bcrypt, but we can issue token manually

        // Manually create tokens since we can't easily mock bcrypt.compare inside startServer without deep mocks
        // Actually startServer exposes the app, but not the key manager easily.
        // But we can hit the login endpoint if we mock bcrypt.

        // For simplicity, let's just use the fact that the server issues tokens in login-verify if we use magic link or something.
        // Or we can mock the jwt.sign? No, that's inside.

        // Easier: Register a user properly?
        // But we are mocking DB.

        // Let's use the login endpoint. We need to match the password hash in mockDb.
        // Since we can't easily know the hash of 'password123', we can't login via password.

        // However, we can use the 'magic-login' flow mock or 'issue-temp-token' if available?
        // 'issue-temp-token' is available for emails.

        // Generate token locally to ensure validity in test env
        const { privateKey, kid } = getCurrentSigningKey();
        userToken = jwt.sign({ email: 'user@example.com' }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    });

    afterAll(() => {
        // cleanup
    });

    it('should prevent Path Traversal in designImagePath during order creation', async () => {
        const maliciousPath = '../.env'; // Try to access .env file

        // Fetch CSRF token
        const csrfRes = await request(app).get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const cookies = csrfRes.headers['set-cookie'];

        // We expect this to fail validation if we fix it.
        // Currently it succeeds (returns 201) and triggers the vulnerability.

        const res = await request(app)
            .post('/api/create-order')
            .set('Authorization', `Bearer ${userToken}`)
            .set('X-CSRF-Token', csrfToken)
            .set('Cookie', cookies)
            .send({
                sourceId: 'cnon:card-nonce-ok',
                amountCents: 1000,
                designImagePath: maliciousPath,
                orderDetails: { quantity: 10 },
                billingContact: {
                    givenName: 'Test',
                    email: 'user@example.com'
                },
                shippingContact: {
                    givenName: 'Test',
                    locality: 'City',
                    administrativeDistrictLevel1: 'State',
                    postalCode: '12345',
                    country: 'US',
                    addressLines: ['123 St']
                }
            });

        // If vulnerable, it returns 201.
        // If fixed, it should return 400.
        expect(res.statusCode).toBe(400);
        // We expect an error about invalid path
        // expect(res.body.errors[0].msg).toContain('Invalid path');
    });

    it('should prevent Path Traversal in designImagePath during product creation', async () => {
        const maliciousPath = '../.env';

        // Fetch CSRF token
        const csrfRes = await request(app).get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const cookies = csrfRes.headers['set-cookie'];

        const res = await request(app)
            .post('/api/products')
            .set('Authorization', `Bearer ${userToken}`)
            .set('X-CSRF-Token', csrfToken)
            .set('Cookie', cookies)
            .send({
                name: 'Malicious Product',
                designImagePath: maliciousPath,
                creatorProfitCents: 100
            });

        expect(res.statusCode).toBe(400);
    });
});
