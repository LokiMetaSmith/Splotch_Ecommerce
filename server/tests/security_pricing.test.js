import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { JSONFilePreset } from 'lowdb/node';

// Import modules
import { startServer } from '../server.js'; // Adjust path if needed
import { getCurrentSigningKey } from '../keyManager.js'; // Adjust path if needed

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security: Price Manipulation & Logic', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, 'test-db-pricing.json');
    let mockSquareClient;
    let mockSendEmail;

    beforeAll(async () => {
        // Ensure clean DB start
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }

        // Setup mock DB
        db = await JSONFilePreset(testDbPath, { orders: {}, users: {}, credentials: {}, config: {}, products: {} });

        // Mock Bot
        bot = {
            telegram: {
                sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
                sendPhoto: jest.fn().mockResolvedValue({ message_id: 124 }),
                sendDocument: jest.fn().mockResolvedValue({ message_id: 125 }),
                editMessageText: jest.fn().mockResolvedValue(true),
                deleteMessage: jest.fn().mockResolvedValue(true)
            },
            stopPolling: jest.fn()
        };

        // Mock SendEmail
        mockSendEmail = jest.fn().mockResolvedValue(true);

        // Mock Square Client
        mockSquareClient = {
            locations: { list: jest.fn() },
            payments: {
                create: jest.fn().mockImplementation(async (payload) => {
                     return {
                        payment: {
                            id: 'payment_fake',
                            orderId: 'square_order_fake',
                            status: 'COMPLETED'
                        }
                     };
                })
            }
        };

        // Set Env Vars
        process.env.TELEGRAM_BOT_TOKEN = 'mock_token';
        process.env.TELEGRAM_CHANNEL_ID = 'mock_channel';
        process.env.ADMIN_EMAIL = 'admin@example.com';
        process.env.NODE_ENV = 'test';

        // Start Server
        const server = await startServer(db, bot, mockSendEmail, testDbPath, mockSquareClient);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen();
    });

    beforeEach(async () => {
        // Reset DB data
        db.data.orders = {};
        db.data.products = {};
        db.data.users = {};
        await db.write();
        jest.clearAllMocks();
    });

    afterAll(async () => {
        if (timers) timers.forEach(timer => clearInterval(timer));
        if (serverInstance) await new Promise(resolve => serverInstance.close(resolve));
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    const getAuthToken = (username = 'testuser', email = 'test@example.com') => {
        const { privateKey, kid } = getCurrentSigningKey();
        return jwt.sign({ username, email }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    };

    it('prevents price manipulation vulnerability: rejects buying expensive product for 1 cent', async () => {
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const token = getAuthToken();

        // 1. Create a product with HIGH creator profit
        const productId = 'expensive_product';
        const creatorId = 'creator_1';
        db.data.users[creatorId] = { id: creatorId, username: 'creator_1', walletBalanceCents: 0 };
        db.data.products[productId] = {
            productId,
            creatorId: creatorId,
            creatorName: 'creator_1',
            name: 'Expensive Art',
            designImagePath: '/uploads/art.png',
            creatorProfitCents: 5000, // $50.00 profit per item
            defaults: {}
        };
        await db.write();

        // 2. Attacker tries to buy 10 items for 1 cent total
        const orderData = {
            sourceId: 'cnon:card-nonce-ok',
            amountCents: 1, // PAYING 1 CENT for $500.00 worth of profit!
            designImagePath: '/uploads/design.png',
            shippingContact: {
                givenName: 'Hacker',
                familyName: 'One',
                addressLines: ['123 Hack St'],
                locality: 'City',
                administrativeDistrictLevel1: 'NY',
                postalCode: '10001',
                country: 'US'
            },
            billingContact: {
                givenName: 'Hacker',
                familyName: 'One',
                email: 'hacker@example.com'
            },
            orderDetails: {
                quantity: 10
            },
            productId: productId
        };

        const res = await agent
            .post('/api/create-order')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrfToken)
            .send(orderData);

        // FIX ASSERTION:
        // We expect this to FAIL (400) because the server now checks price.
        expect(res.statusCode).toEqual(400);
        expect(res.body.error).toContain('Order amount is too low');

        // Verify the creator did NOT get paid
        const creator = db.data.users[creatorId];
        expect(creator.walletBalanceCents).toEqual(0);

        // This confirms the platform is safe
    });
});
