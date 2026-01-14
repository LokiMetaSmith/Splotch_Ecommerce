import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { JSONFilePreset } from 'lowdb/node';

import { startServer } from '../server/server.js';
import { getCurrentSigningKey } from '../server/keyManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security Input Validation', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, '../server/test-db-security.json');
    let mockSquareClient;

    beforeAll(async () => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

        db = await JSONFilePreset(testDbPath, { orders: {}, users: {}, credentials: {}, config: {} });

        bot = {
            telegram: {
                sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
                sendPhoto: jest.fn().mockResolvedValue({ message_id: 124 }),
                sendDocument: jest.fn().mockResolvedValue({ message_id: 125 }),
            }
        };

        mockSquareClient = {
            locations: { list: jest.fn() },
            payments: {
                create: jest.fn().mockResolvedValue({
                    payment: { id: 'p_1', orderId: 'sq_1', status: 'COMPLETED' }
                })
            }
        };

        process.env.SESSION_SECRET = 'test-secret'; // Ensure session secret is set

        const server = await startServer(db, bot, jest.fn(), testDbPath, mockSquareClient);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen();
    });

    beforeEach(async () => {
        db.data.orders = {};
        await db.write();
        jest.clearAllMocks();
    });

    afterAll(async () => {
        if (timers) timers.forEach(t => clearInterval(t));
        if (serverInstance) await new Promise(r => serverInstance.close(r));
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    const getAuthToken = () => {
        const { privateKey, kid } = getCurrentSigningKey();
        return jwt.sign({ username: 'test', email: 'test@example.com' }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    };

    it('should REJECT malicious address lines', async () => {
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const token = getAuthToken();

        const res = await agent
            .post('/api/create-order')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrfRes.body.csrfToken)
            .send({
                sourceId: 'cnon:card-nonce-ok',
                amountCents: 1000,
                designImagePath: '/u/d.png',
                shippingContact: {
                    givenName: 'Bad', familyName: 'Actor',
                    email: 'bad@actor.com',
                    // MALICIOUS INPUT
                    addressLines: ['<script>alert(1)</script>', 'Normal St'],
                    locality: 'City', administrativeDistrictLevel1: 'ST', postalCode: '11111', country: 'US',
                    phoneNumber: '1234567890'
                },
                billingContact: {
                    givenName: 'Bad', email: 'bad@actor.com'
                },
                orderDetails: { quantity: 1 }
            });

        expect(res.statusCode).toBe(400);
        if (res.body.errors) {
            const errors = res.body.errors.map(e => e.msg);
            expect(JSON.stringify(errors)).toContain('Invalid characters in Address Lines');
        }
    });

    it('should REJECT malicious phone number', async () => {
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const token = getAuthToken();

        const res = await agent
            .post('/api/create-order')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrfRes.body.csrfToken)
            .send({
                sourceId: 'cnon:card-nonce-ok',
                amountCents: 1000,
                designImagePath: '/u/d.png',
                shippingContact: {
                    givenName: 'Bad', familyName: 'Actor',
                    email: 'bad@actor.com',
                    addressLines: ['123 St'],
                    locality: 'City', administrativeDistrictLevel1: 'ST', postalCode: '11111', country: 'US',
                    // MALICIOUS INPUT
                    phoneNumber: '<script>evil()</script>'
                },
                billingContact: {
                    givenName: 'Bad', email: 'bad@actor.com'
                },
                orderDetails: { quantity: 1 }
            });

        expect(res.statusCode).toBe(400);
        if (res.body.errors) {
            const errors = res.body.errors.map(e => e.msg);
            expect(JSON.stringify(errors)).toContain('Invalid Phone Number');
        }
    });

     it('should ACCEPT valid input', async () => {
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const token = getAuthToken();

        const res = await agent
            .post('/api/create-order')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrfRes.body.csrfToken)
            .send({
                sourceId: 'cnon:card-nonce-ok',
                amountCents: 1000,
                designImagePath: '/u/d.png',
                shippingContact: {
                    givenName: 'Good', familyName: 'User',
                    email: 'good@user.com',
                    addressLines: ['123 Valid St', 'Apt 4'],
                    locality: 'City', administrativeDistrictLevel1: 'ST', postalCode: '11111', country: 'US',
                    phoneNumber: '123-456-7890'
                },
                billingContact: {
                    givenName: 'Good', email: 'good@user.com'
                },
                orderDetails: { quantity: 1 }
            });

        expect(res.statusCode).toBe(201);
    });
});
