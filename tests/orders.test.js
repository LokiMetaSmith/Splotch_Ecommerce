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

describe('Order API Endpoints', () => {
    let app;
    let db;
    let bot;
    let serverInstance;
    let timers;
    const testDbPath = path.join(__dirname, '../server/test-db-orders.json');
    let mockSquareClient;
    let mockSendEmail;

    beforeAll(async () => {
        // Ensure clean DB start
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }

        // Setup mock DB
        db = await JSONFilePreset(testDbPath, { orders: {}, users: {}, credentials: {}, config: {} });

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
                     if (payload.sourceId === 'cnon:card-nonce-declined') {
                        const error = new Error('Card declined');
                        error.statusCode = 400;
                        error.result = { errors: [{ code: 'CARD_DECLINED', detail: 'Card declined.' }] };
                        throw error;
                     }
                     return {
                        payment: {
                            id: 'payment_123',
                            orderId: 'square_order_123',
                            status: 'COMPLETED'
                        }
                     };
                })
            }
        };

        // Set Env Vars for Notification logic
        process.env.TELEGRAM_BOT_TOKEN = 'mock_token';
        process.env.TELEGRAM_CHANNEL_ID = 'mock_channel';
        process.env.ADMIN_EMAIL = 'admin@example.com';
        process.env.NODE_ENV = 'test';

        // Start Server with injections
        const server = await startServer(db, bot, mockSendEmail, testDbPath, mockSquareClient);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen();
    });

    beforeEach(async () => {
        // Reset DB data (in memory object linked to file)
        db.data.orders = {};
        db.data.users = {};
        await db.write();
        // Clear mock calls
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

    describe('POST /api/create-order', () => {
        it('should create an order successfully', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken();

            const orderData = {
                sourceId: 'cnon:card-nonce-ok',
                amountCents: 1000,
                designImagePath: '/uploads/design.png',
                shippingContact: {
                    givenName: 'John',
                    familyName: 'Doe',
                    email: 'john@example.com',
                    addressLines: ['123 Main St'],
                    locality: 'Anytown',
                    administrativeDistrictLevel1: 'NY',
                    postalCode: '10001',
                    country: 'US'
                },
                billingContact: {
                    givenName: 'John',
                    familyName: 'Doe',
                    email: 'john@example.com'
                },
                orderDetails: {
                    quantity: 10
                }
            };

            const res = await agent
                .post('/api/create-order')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .send(orderData);

            expect(res.statusCode).toEqual(201);
            expect(res.body.success).toBe(true);
            expect(res.body.order.status).toBe('NEW');
            expect(mockSquareClient.payments.create).toHaveBeenCalled();
            expect(Object.keys(db.data.orders)).toHaveLength(1);
            expect(bot.telegram.sendMessage).toHaveBeenCalled();

            // Verify that telegramMessageId was updated (regression test for O(N) lookup fix)
            expect(db.data.orders[res.body.order.orderId].telegramMessageId).toBe(123);
        });

        it('should fail with invalid data', async () => {
             const agent = request.agent(app);
             const csrfRes = await agent.get('/api/csrf-token');
             const csrfToken = csrfRes.body.csrfToken;
             const token = getAuthToken();

             const res = await agent
                .post('/api/create-order')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .send({}); // Empty body

             expect(res.statusCode).toEqual(400);
        });

        it('should handle Square API errors', async () => {
             const agent = request.agent(app);
             const csrfRes = await agent.get('/api/csrf-token');
             const csrfToken = csrfRes.body.csrfToken;
             const token = getAuthToken();

             const orderData = {
                sourceId: 'cnon:card-nonce-declined',
                amountCents: 1000,
                designImagePath: '/uploads/design.png',
                 shippingContact: {},
                 billingContact: {},
                 orderDetails: { quantity: 1 }
             };

             const res = await agent
                .post('/api/create-order')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .send(orderData);

             expect(res.statusCode).toEqual(400);
             expect(res.body.error).toContain('Square API Error');
        });
    });

    describe('GET /api/orders/:orderId', () => {
        it('should allow admin to view any order', async () => {
             // Create an order in DB
             const order = {
                 orderId: 'order_1',
                 billingContact: { email: 'user@example.com' },
                 amount: 1000
             };
             db.data.orders[order.orderId] = order;
             await db.write();

             const adminToken = getAuthToken('admin', 'admin@example.com');

             const res = await request(app)
                .get('/api/orders/order_1')
                .set('Authorization', `Bearer ${adminToken}`);

             expect(res.statusCode).toEqual(200);
             expect(res.body.orderId).toEqual('order_1');
        });

        it('should allow owner to view their order', async () => {
             const order = {
                 orderId: 'order_2',
                 billingContact: { email: 'owner@example.com' },
                 amount: 1000
             };
             db.data.orders[order.orderId] = order;
             await db.write();

             const ownerToken = getAuthToken('owner', 'owner@example.com');

             const res = await request(app)
                .get('/api/orders/order_2')
                .set('Authorization', `Bearer ${ownerToken}`);

             expect(res.statusCode).toEqual(200);
        });

        it('should deny access to unauthorized user', async () => {
             const order = {
                 orderId: 'order_3',
                 billingContact: { email: 'owner@example.com' },
                 amount: 1000
             };
             db.data.orders[order.orderId] = order;
             await db.write();

             const otherToken = getAuthToken('other', 'other@example.com');

             const res = await request(app)
                .get('/api/orders/order_3')
                .set('Authorization', `Bearer ${otherToken}`);

             expect(res.statusCode).toEqual(404);
        });
    });

    describe('POST /api/orders/:orderId/status', () => {
        it('should update status and send telegram notification', async () => {
             const order = {
                 orderId: 'order_4',
                 billingContact: { email: 'user@example.com', givenName: 'Test', familyName: 'User' },
                 orderDetails: { quantity: 5 },
                 amount: 500,
                 status: 'NEW',
                 telegramMessageId: 999
             };
             db.data.orders[order.orderId] = order;
             await db.write();

             const agent = request.agent(app);
             const csrfRes = await agent.get('/api/csrf-token');
             const csrfToken = csrfRes.body.csrfToken;
             // Use admin token now that RBAC is enforced
             const token = getAuthToken('admin', 'admin@example.com');

             const res = await agent
                .post('/api/orders/order_4/status')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .send({ status: 'PRINTING' });

             expect(res.statusCode).toEqual(200);
             expect(db.data.orders[order.orderId].status).toEqual('PRINTING');
             expect(bot.telegram.editMessageText).toHaveBeenCalled();
        });
    });

     describe('POST /api/orders/:orderId/tracking', () => {
        it('should update tracking info and send email', async () => {
             const order = {
                 orderId: 'order_5',
                 billingContact: { email: 'user@example.com', givenName: 'Test', familyName: 'User' },
                 shippingContact: {
                     givenName: 'Test', familyName: 'User',
                     addressLines: ['123 St'], locality: 'City', administrativeDistrictLevel1: 'ST', postalCode: '11111', country: 'US'
                 },
                 orderDetails: { quantity: 5 },
                 amount: 500,
                 status: 'PRINTING'
             };
             db.data.orders[order.orderId] = order;
             await db.write();

             const agent = request.agent(app);
             const csrfRes = await agent.get('/api/csrf-token');
             const csrfToken = csrfRes.body.csrfToken;
             // Use admin token now that RBAC is enforced
             const token = getAuthToken('admin', 'admin@example.com');

             const res = await agent
                .post('/api/orders/order_5/tracking')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .send({ trackingNumber: 'TRACK123', courier: 'UPS' });

             expect(res.statusCode).toEqual(200);
             expect(db.data.orders[order.orderId].trackingNumber).toEqual('TRACK123');
             expect(mockSendEmail).toHaveBeenCalled();
        });
    });

    describe('GET /api/orders (Admin List)', () => {
        it('should allow env-defined admin to view all orders', async () => {
            db.data.orders['o1'] = { orderId: 'o1', receivedAt: '2023-01-01' };
            db.data.orders['o2'] = { orderId: 'o2', receivedAt: '2023-01-02' };
            await db.write();

            const token = getAuthToken('admin', 'admin@example.com'); // Matches process.env.ADMIN_EMAIL
            const res = await request(app)
                .get('/api/orders')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveLength(2);
            expect(res.body[0].orderId).toBe('o2');
        });

        it('should allow user with "admin" role to view all orders', async () => {
            db.data.orders['o1'] = { orderId: 'o1', receivedAt: '2023-01-01' };
            // Create a user with admin role who is NOT the env admin
            const adminUser = {
                id: 'role_admin',
                username: 'roleadmin',
                email: 'role@admin.com',
                role: 'admin'
            };
            db.data.users['roleadmin'] = adminUser;
            db.data.emailIndex['role@admin.com'] = 'roleadmin';
            await db.write();

            const token = getAuthToken('roleadmin', 'role@admin.com');
            const res = await request(app)
                .get('/api/orders')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveLength(1);
        });

        it('should deny non-admin users (even if migrated)', async () => {
            // Create a regular user
             const regularUser = {
                id: 'regular_user',
                username: 'regular',
                email: 'regular@example.com',
                role: 'user'
            };
            db.data.users['regular'] = regularUser;
            db.data.emailIndex['regular@example.com'] = 'regular';
            await db.write();

            const token = getAuthToken('regular', 'regular@example.com');
            const res = await request(app)
                .get('/api/orders')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(403);
        });
    });

    describe('GET /api/orders/my-orders', () => {
        it('should return orders for the authenticated user', async () => {
            const email = 'my@example.com';
            db.data.orders['my1'] = { orderId: 'my1', billingContact: { email }, receivedAt: '2023-01-01' };
            db.data.orders['other1'] = { orderId: 'other1', billingContact: { email: 'other@example.com' }, receivedAt: '2023-01-02' };
            await db.write();

            const token = getAuthToken('myuser', email);
            const res = await request(app)
                .get('/api/orders/my-orders')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].orderId).toBe('my1');
        });

        it('should return empty list if user has no orders', async () => {
            const token = getAuthToken('newuser', 'new@example.com');
            const res = await request(app)
                .get('/api/orders/my-orders')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveLength(0);
        });
    });

    describe('GET /api/orders/search', () => {
        it('should allow user to search their orders', async () => {
            const email = 'search@example.com';
            // User must exist for search endpoint
            db.data.users['searchuser'] = { email, username: 'searchuser' };
            db.data.emailIndex = { [email]: 'searchuser' };
            db.data.orders['search123'] = { orderId: 'search123', billingContact: { email }, receivedAt: '2023-01-01' };
            db.data.orders['search456'] = { orderId: 'search456', billingContact: { email }, receivedAt: '2023-01-02' };
            await db.write();

            const token = getAuthToken('searchuser', email);
            const res = await request(app)
                .get('/api/orders/search?q=123')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].orderId).toBe('search123');
        });

        it('should not find other users orders even if ID matches query', async () => {
             const email = 'user1@example.com';
             db.data.users['user1'] = { email, username: 'user1' };
             db.data.emailIndex = { [email]: 'user1' };
             db.data.orders['secret123'] = { orderId: 'secret123', billingContact: { email: 'admin@example.com' } };
             await db.write();

             const token = getAuthToken('user1', email);
             const res = await request(app)
                .get('/api/orders/search?q=123')
                .set('Authorization', `Bearer ${token}`);

             // The search filters by user email first, then by query.
             // If filteredOrders is empty, it returns 404.
             expect(res.statusCode).toBe(404);
        });

        it('should return 404 if no order matches', async () => {
            const email = 'search@example.com';
            db.data.users['searchuser'] = { email, username: 'searchuser' };
            db.data.emailIndex = { [email]: 'searchuser' };
            await db.write();

            const token = getAuthToken('searchuser', email);
            const res = await request(app)
                .get('/api/orders/search?q=nonexistent')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(404);
        });
    });
});
