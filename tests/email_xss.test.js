
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

describe('Email Stored XSS Vulnerability Check', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, '../server/test-db-email-xss.json');
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
    });

    const getAuthToken = (username = 'testuser', email = 'test@example.com', role = 'user') => {
        const { privateKey, kid } = getCurrentSigningKey();
        const payload = { username, email };
        // We mock isAdmin by checking email against ADMIN_EMAIL or role
        if (role === 'admin') {
             // In server.js, isAdmin checks process.env.ADMIN_EMAIL === email OR user.role === 'admin'
             // Here we use the email match for simplicity
             payload.email = process.env.ADMIN_EMAIL;
        }
        return jwt.sign(payload, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    };

    it('should NOT allow XSS in email when adding tracking info', async () => {
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;

        // 1. Create an order with XSS payload in addressLines
        // The endpoint validates specific fields but addressLines is just checked to be an array.
        // It does NOT check for '<' in array elements!

        const xssPayload = "<script>alert('XSS')</script>";
        const safePart = "123 Safe St";

        const orderId = 'order_xss_test';
        const maliciousOrder = {
            orderId: orderId,
            status: 'SHIPPED',
            amount: 1000,
            billingContact: {
                givenName: 'Victim',
                familyName: 'User',
                email: 'victim@example.com'
            },
            shippingContact: {
                givenName: 'Victim',
                familyName: 'User',
                addressLines: [safePart, xssPayload], // XSS INJECTION HERE
                locality: 'City',
                administrativeDistrictLevel1: 'State',
                postalCode: '12345',
                country: 'US'
            },
            orderDetails: { quantity: 1 },
            receivedAt: new Date().toISOString()
        };

        // Manually inject order into DB because create-order validation MIGHT stop it (but we found it doesn't check array contents deeply)
        // Actually, create-order `shippingContact.addressLines` validation is `isArray()`. It does NOT check contents.
        // But to be sure we are testing the EMAIL GENERATION logic, let's inject directly.
        db.data.orders[orderId] = maliciousOrder;
        await db.write();

        // 2. Trigger tracking update as Admin
        const adminToken = getAuthToken('admin', 'admin@example.com', 'admin');
        const res = await agent
            .post(`/api/orders/${orderId}/tracking`)
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-CSRF-Token', csrfToken)
            .send({
                trackingNumber: 'TRACK123',
                courier: 'USPS'
            });

        if (res.statusCode !== 200) {
            console.log('Error Response:', res.body);
        }
        expect(res.statusCode).toBe(200);

        // 3. Verify sendEmail was called
        expect(mockSendEmail).toHaveBeenCalled();

        // 4. Inspect the HTML content of the email
        const emailCallArgs = mockSendEmail.mock.calls[0][0];
        const emailHtml = emailCallArgs.html;

        // 5. The XSS payload should be ESCAPED
        // If vulnerabilities exists: it will contain <script>...
        // If fixed: it will contain &lt;script&gt;...

        const escapedPayload = "&lt;script&gt;alert(&#039;XSS&#039;)&lt;/script&gt;";
        expect(emailHtml).not.toContain(xssPayload);
        expect(emailHtml).toContain(escapedPayload);
    });
});
