
import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { JSONFilePreset } from 'lowdb/node';

// Import modules
import { getCurrentSigningKey } from '../server/keyManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Stored XSS Vulnerability Check (Order Details)', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, '../server/test-db-xss-details.json');
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
                create: jest.fn().mockResolvedValue({
                    payment: {
                        id: 'payment_123',
                        orderId: 'square_order_123',
                        status: 'COMPLETED'
                    }
                })
            }
        };

        // Set Env Vars
        process.env.TELEGRAM_BOT_TOKEN = 'mock_token';
        process.env.TELEGRAM_CHANNEL_ID = 'mock_channel';
        process.env.ADMIN_EMAIL = 'admin@example.com';
        process.env.NODE_ENV = 'test';
        process.env.SQUARE_ACCESS_TOKEN = 'mock_square_token';

        // Ensure dummy file exists for tests
        const uploadsDir = path.join(__dirname, '../server/uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        if (fs.existsSync(path.join(__dirname, '../favicon.png'))) {
             fs.copyFileSync(path.join(__dirname, '../favicon.png'), path.join(uploadsDir, 'd.png'));
        }

        // Mock WAF to bypass middleware blocking and test controller sanitization
        jest.unstable_mockModule('../server/waf.js', () => ({
            wafMiddleware: (req, res, next) => next(),
        }));
        const { startServer } = await import('../server/server.js');

        // Start Server
        const server = await startServer(db, bot, mockSendEmail, testDbPath, mockSquareClient);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen();
    });

    beforeEach(async () => {
        db.data.orders = {};
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
        const uploadsDir = path.join(__dirname, '../server/uploads');
        if (fs.existsSync(path.join(uploadsDir, 'd.png'))) {
            fs.unlinkSync(path.join(uploadsDir, 'd.png'));
        }
    });

    const getAuthToken = (username = 'testuser', email = 'test@example.com') => {
        const { privateKey, kid } = getCurrentSigningKey();
        return jwt.sign({ username, email }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    };

    it('should sanitize arbitrary fields in orderDetails', async () => {
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const token = getAuthToken();

        const maliciousPayload = {
            sourceId: 'cnon:card-nonce-ok',
            amountCents: 1, // Adjusted to match calculated price of favicon.png (approx 1 cent)
            designImagePath: '/uploads/d.png',
            shippingContact: {
                givenName: 'Hacker',
                familyName: 'One',
                email: 'hacker@example.com',
                addressLines: ['123 Hack St'],
                locality: 'CyberCity',
                administrativeDistrictLevel1: 'NY',
                postalCode: '13337',
                country: 'US'
            },
            billingContact: {
                givenName: 'Hacker',
                familyName: 'One',
                email: 'hacker@example.com'
            },
            orderDetails: {
                quantity: 1,
                // INJECTED PAYLOAD
                description: "<script>alert('XSS')</script>"
            },
            // Try to inject outside
            "injectedField": "I shouldn't be here"
        };

        const res = await agent
            .post('/api/create-order')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrfToken)
            .send(maliciousPayload);

        expect(res.statusCode).toEqual(201);

        const createdOrder = res.body.order;
        const dbOrder = db.data.orders[createdOrder.orderId];

        // Assert that unexpected fields inside orderDetails are NOT present.
        expect(dbOrder.orderDetails).not.toHaveProperty('description');
        expect(dbOrder.orderDetails.quantity).toBe(1);

        // Also check if root level injection works (it shouldn't)
        expect(dbOrder).not.toHaveProperty('injectedField');
    });
});
