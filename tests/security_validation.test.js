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

describe('Security: Input Validation', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, '../server/test-db-security.json');
    let mockSquareClient;
    let mockSendEmail;

    beforeAll(async () => {
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        db = await JSONFilePreset(testDbPath, { orders: {}, users: {}, credentials: {}, config: {} });

        bot = {
            telegram: {
                sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
                sendPhoto: jest.fn().mockResolvedValue({ message_id: 124 }),
                sendDocument: jest.fn().mockResolvedValue({ message_id: 125 }),
            },
        };
        mockSendEmail = jest.fn().mockResolvedValue(true);
        mockSquareClient = {
            locations: { list: jest.fn() },
            payments: {
                create: jest.fn().mockResolvedValue({ payment: { id: 'pay_1', orderId: 'sq_1', status: 'COMPLETED' } })
            }
        };

        process.env.TELEGRAM_BOT_TOKEN = 'mock_token';
        process.env.TELEGRAM_CHANNEL_ID = 'mock_channel';
        process.env.NODE_ENV = 'test';

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
    });

    const getAuthToken = () => {
        const { privateKey, kid } = getCurrentSigningKey();
        return jwt.sign({ username: 'testuser', email: 'test@example.com' }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    };

    it('should REJECT malicious XSS input', async () => {
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const token = getAuthToken();

        const maliciousOrder = {
            sourceId: 'cnon:card-nonce-ok',
            amountCents: 1000,
            designImagePath: '/uploads/design.png',
            billingContact: {
                givenName: '<script>alert("XSS")</script>', // Malicious input
                familyName: 'Hacker',
                email: 'hacker@example.com'
            },
            shippingContact: {
                givenName: 'Hacker',
                familyName: 'One',
                email: 'hacker@example.com',
                addressLines: ['123 Evil St'],
                locality: 'DarkWeb',
                administrativeDistrictLevel1: 'NA',
                postalCode: '66666',
                country: 'US'
            },
            orderDetails: { quantity: 1 }
        };

        const res = await agent
            .post('/api/create-order')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrfToken)
            .send(maliciousOrder);

        // Should return 400 Bad Request
        expect(res.statusCode).toEqual(400);
        expect(res.body.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ msg: 'Invalid characters in Billing First Name' })
            ])
        );
    });

    it('should REJECT missing contact fields', async () => {
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const token = getAuthToken();

        const brokenOrder = {
            sourceId: 'cnon:card-nonce-ok',
            amountCents: 1000,
            designImagePath: '/uploads/design.png',
            // billingContact is MISSING
            shippingContact: {
                givenName: 'Test',
                familyName: 'User',
                email: 'test@example.com',
                addressLines: ['1 St'],
                locality: 'City',
                administrativeDistrictLevel1: 'ST',
                postalCode: '11111',
                country: 'US'
            },
            orderDetails: { quantity: 1 }
        };

        const res = await agent
            .post('/api/create-order')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrfToken)
            .send(brokenOrder);

        expect(res.statusCode).toEqual(400);
        expect(res.body.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ msg: 'billingContact must be an object' })
            ])
        );
    });
});
