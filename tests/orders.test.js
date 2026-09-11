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
import { calcOrderBreakdown, DEFAULT_SHIPPING_CONFIG } from '../server/lib/costCalc.js';

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
            orders: {
                create: jest.fn().mockImplementation(async (payload) => {
                    return {
                        order: {
                            id: 'square_order_123',
                            totalMoney: payload?.order?.lineItems?.[0]?.basePriceMoney || { amount: 820n, currency: 'USD' }
                        }
                    };
                })
            },
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
                            orderId: payload.orderId || 'square_order_123',
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

        // Ensure dummy upload file exists for pricing validation
        const uploadsDir = path.join(__dirname, '../server/uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        // Copy a real image to satisfy image-size
        fs.copyFileSync(path.join(__dirname, '../favicon.png'), path.join(uploadsDir, 'design.png'));

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
        db.data.emailIndex = {};
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
        // Cleanup dummy upload
        const dummyUpload = path.join(__dirname, '../server/uploads/design.png');
        if (fs.existsSync(dummyUpload)) {
            fs.unlinkSync(dummyUpload);
        }
    });

    const getAuthToken = (username = 'testuser', email = 'test@example.com', role = 'user') => {
        const { privateKey, kid } = getCurrentSigningKey();
        return jwt.sign({ username, email, role }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    };

    // Helper to rebuild the userOrderIndex since we bypass the server logic when injecting data directly
    const rebuildIndex = () => {
        if (!db.userOrderIndex) db.userOrderIndex = {};
        // Clear existing
        for (const key in db.userOrderIndex) delete db.userOrderIndex[key];

        Object.values(db.data.orders).forEach(order => {
            const email = order.billingContact?.email;
            if (email) {
                if (!db.userOrderIndex[email]) db.userOrderIndex[email] = [];
                db.userOrderIndex[email].push(order);
            }
        });
    };

    describe('POST /api/create-order', () => {
        it('should create an order successfully', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken();

            // Calculate expected grand total for 10x favicon items (approx 2 cents subtotal)
            const expectedSubtotal = 2;
            const breakdown = calcOrderBreakdown({
                areaInSqIn: 1,
                subtotalCents: expectedSubtotal,
                config: DEFAULT_SHIPPING_CONFIG,
                destinationState: 'NY'
            });

            const orderData = {
                sourceId: 'cnon:card-nonce-ok',
                amountCents: breakdown.totalCents,
                orderReadyConfirmed: true,
                packageAreaSqIn: 1,
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
            expect(res.body.order.amount).toBe(breakdown.totalCents);
            expect(res.body.order.subtotalCents).toBe(expectedSubtotal);
            expect(res.body.order.shippingCents).toBe(breakdown.shippingCents);
            expect(mockSquareClient.orders.create).toHaveBeenCalled();
            expect(mockSquareClient.payments.create).toHaveBeenCalled();
            expect(Object.keys(db.data.orders)).toHaveLength(1);
            expect(bot.telegram.sendMessage).toHaveBeenCalled();

            // Verify that telegramMessageId was updated (regression test for O(N) lookup fix)
            expect(db.data.orders[res.body.order.orderId].telegramMessageId).toBe(123);
        });

        it('should fail if orderReadyConfirmed is missing or false', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken();

            const orderData = {
                sourceId: 'cnon:card-nonce-ok',
                amountCents: 500,
                orderReadyConfirmed: false, // Not confirmed
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
                orderDetails: { quantity: 1 }
            };

            const res = await agent
                .post('/api/create-order')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .send(orderData);

            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toMatch(/Order confirmation required/i);
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

        it('should fail if order amount is significantly less than calculated price', async () => {
             const agent = request.agent(app);
             const csrfRes = await agent.get('/api/csrf-token');
             const csrfToken = csrfRes.body.csrfToken;
             const token = getAuthToken();

             const orderData = {
                sourceId: 'cnon:card-nonce-ok',
                amountCents: 1, // Intentionally low amount (1 cent)
                orderReadyConfirmed: true,
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
                    quantity: 1000, // Large quantity to make price ~171 cents
                    material: 'pp_standard' // Explicitly set material
                }
             };

             const res = await agent
                .post('/api/create-order')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .send(orderData);

             expect(res.statusCode).toEqual(400);
             expect(res.body.error).toMatch(/Price mismatch/i);
        });

        it('should handle Square API errors', async () => {
             const agent = request.agent(app);
             const csrfRes = await agent.get('/api/csrf-token');
             const csrfToken = csrfRes.body.csrfToken;
             const token = getAuthToken();

             // Price for quantity 1 of favicon.png is 0 cents subtotal
             const breakdown = calcOrderBreakdown({
                 areaInSqIn: 1,
                 subtotalCents: 0,
                 config: DEFAULT_SHIPPING_CONFIG
             });

             const orderData = {
                sourceId: 'cnon:card-nonce-declined',
                amountCents: breakdown.totalCents,
                orderReadyConfirmed: true,
                packageAreaSqIn: 1,
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
                 orderDetails: { quantity: 1 }
             };

             const res = await agent
                .post('/api/create-order')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .send(orderData);

             expect(res.statusCode).toEqual(400);
             if (res.body.message) {
                 expect(res.body.message).toContain('Card declined');
             } else if (res.body.error) {
                 expect(res.body.error).toBeDefined();
             }
        });

        it('should support different billing and shipping addresses', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken();

            const expectedSubtotal = 2;
            const breakdown = calcOrderBreakdown({
                areaInSqIn: 1,
                subtotalCents: expectedSubtotal,
                config: DEFAULT_SHIPPING_CONFIG,
                destinationState: 'OK'
            });

            const orderData = {
                sourceId: 'cnon:card-nonce-ok',
                amountCents: breakdown.totalCents,
                orderReadyConfirmed: true,
                packageAreaSqIn: 1,
                designImagePath: '/uploads/design.png',
                shippingContact: {
                    givenName: 'Recipient',
                    familyName: 'Shipped',
                    email: 'ship@example.com',
                    addressLines: ['100 Shipping Way'],
                    locality: 'Oklahoma City',
                    administrativeDistrictLevel1: 'OK',
                    postalCode: '73101',
                    country: 'US'
                },
                billingContact: {
                    givenName: 'Cardholder',
                    familyName: 'Buyer',
                    email: 'buyer@example.com',
                    phoneNumber: '(555) 000-1111',
                    addressLines: ['200 Wall St, Suite 5'],
                    locality: 'New York',
                    administrativeDistrictLevel1: 'NY',
                    postalCode: '10005',
                    country: 'US'
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
            const order = res.body.order;

            // Verify billingContact preserved its distinct address
            expect(order.billingContact.givenName).toBe('Cardholder');
            expect(order.billingContact.addressLines).toEqual(['200 Wall St, Suite 5']);
            expect(order.billingContact.locality).toBe('New York');
            expect(order.billingContact.administrativeDistrictLevel1).toBe('NY');
            expect(order.billingContact.postalCode).toBe('10005');

            // Verify shippingContact preserved its distinct address
            expect(order.shippingContact.givenName).toBe('Recipient');
            expect(order.shippingContact.addressLines).toEqual(['100 Shipping Way']);
            expect(order.shippingContact.locality).toBe('Oklahoma City');
            expect(order.shippingContact.administrativeDistrictLevel1).toBe('OK');
            expect(order.shippingContact.postalCode).toBe('73101');

            // Verify Square payment was called with both distinct addresses
            const lastPaymentCall = mockSquareClient.payments.create.mock.calls[mockSquareClient.payments.create.mock.calls.length - 1][0];
            expect(lastPaymentCall.billingAddress.addressLine1).toBe('200 Wall St, Suite 5');
            expect(lastPaymentCall.billingAddress.locality).toBe('New York');
            expect(lastPaymentCall.billingAddress.administrativeDistrictLevel1).toBe('NY');
            expect(lastPaymentCall.billingAddress.postalCode).toBe('10005');

            expect(lastPaymentCall.shippingAddress.addressLine1).toBe('100 Shipping Way');
            expect(lastPaymentCall.shippingAddress.locality).toBe('Oklahoma City');
            expect(lastPaymentCall.shippingAddress.administrativeDistrictLevel1).toBe('OK');
            expect(lastPaymentCall.shippingAddress.postalCode).toBe('73101');
        });
    });

    describe('GET /api/orders/:orderId', () => {
        it('should allow admin to view any order', async () => {
             // Create an order in DB
             const orderId = '550e8400-e29b-41d4-a716-446655440001';
             const order = {
                 orderId: orderId,
                 billingContact: { email: 'user@example.com' },
                 amount: 1000
             };
             db.data.orders[order.orderId] = order;
             await db.write();

             const adminToken = getAuthToken('admin', 'admin@example.com');

             const res = await request(app)
                .get(`/api/orders/${orderId}`)
                .set('Authorization', `Bearer ${adminToken}`);

             expect(res.statusCode).toEqual(200);
             expect(res.body.orderId).toEqual(orderId);
        });

        it('should allow owner to view their order', async () => {
             const orderId = '550e8400-e29b-41d4-a716-446655440002';
             const order = {
                 orderId: orderId,
                 billingContact: { email: 'owner@example.com' },
                 amount: 1000
             };
             db.data.orders[order.orderId] = order;
             await db.write();

             const ownerToken = getAuthToken('owner', 'owner@example.com');

             const res = await request(app)
                .get(`/api/orders/${orderId}`)
                .set('Authorization', `Bearer ${ownerToken}`);

             expect(res.statusCode).toEqual(200);
        });

        it('should deny access to unauthorized user', async () => {
             const orderId = '550e8400-e29b-41d4-a716-446655440003';
             const order = {
                 orderId: orderId,
                 billingContact: { email: 'owner@example.com' },
                 amount: 1000
             };
             db.data.orders[order.orderId] = order;
             await db.write();

             const otherToken = getAuthToken('other', 'other@example.com');

             const res = await request(app)
                .get(`/api/orders/${orderId}`)
                .set('Authorization', `Bearer ${otherToken}`);

             expect(res.statusCode).toEqual(404);
        });
    });

    describe('POST /api/orders/:orderId/status', () => {
        it('should update status and send telegram notification', async () => {
             const orderId = '550e8400-e29b-41d4-a716-446655440004';
             const order = {
                 orderId: orderId,
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
                .post(`/api/orders/${orderId}/status`)
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
             const orderId = '550e8400-e29b-41d4-a716-446655440005';
             const order = {
                 orderId: orderId,
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
                .post(`/api/orders/${orderId}/tracking`)
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
            const o1 = '550e8400-e29b-41d4-a716-446655440006';
            const o2 = '550e8400-e29b-41d4-a716-446655440007';
            db.data.orders[o1] = { orderId: o1, receivedAt: '2023-01-01' };
            db.data.orders[o2] = { orderId: o2, receivedAt: '2023-01-02' };
            await db.write();

            const token = getAuthToken('admin', 'admin@example.com'); // Matches process.env.ADMIN_EMAIL
            const res = await request(app)
                .get('/api/orders')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveLength(2);
            expect(res.body[0].orderId).toBe(o2);
        });

        it('should allow user with "admin" role to view all orders', async () => {
            const o1 = '550e8400-e29b-41d4-a716-446655440006';
            db.data.orders[o1] = { orderId: o1, receivedAt: '2023-01-01' };
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
            const my1 = '550e8400-e29b-41d4-a716-446655440008';
            const other1 = '550e8400-e29b-41d4-a716-446655440009';
            db.data.orders[my1] = { orderId: my1, billingContact: { email }, receivedAt: '2023-01-01' };
            db.data.orders[other1] = { orderId: other1, billingContact: { email: 'other@example.com' }, receivedAt: '2023-01-02' };
            await db.write();
            rebuildIndex();

            const token = getAuthToken('myuser', email);
            const res = await request(app)
                .get('/api/orders/my-orders')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].orderId).toBe(my1);
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
            const search123 = '550e8400-e29b-41d4-a716-446655440010';
            const search456 = '550e8400-e29b-41d4-a716-446655440011';

            db.data.orders[search123] = { orderId: search123, billingContact: { email }, receivedAt: '2023-01-01' };
            db.data.orders[search456] = { orderId: search456, billingContact: { email }, receivedAt: '2023-01-02' };
            await db.write();
            rebuildIndex();

            const token = getAuthToken('searchuser', email);
            const res = await request(app)
                .get('/api/orders/search?q=0010')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].orderId).toBe(search123);
        });

        it('should not find other users orders even if ID matches query', async () => {
             const email = 'user1@example.com';
             // Explicitly make sure this user is not admin
             db.data.users['user1'] = { email, username: 'user1', role: 'user' };
             db.data.emailIndex = { [email]: 'user1' };
             const secret123 = '550e8400-e29b-41d4-a716-446655440012';
             db.data.orders[secret123] = { orderId: secret123, billingContact: { email: 'admin@example.com' } };
             await db.write();
             rebuildIndex();

             // Ensure the user role is accurately placed in token
             const token = getAuthToken('user1', email, 'user');
             const res = await request(app)
                .get('/api/orders/search?q=0012')
                .set('Authorization', `Bearer ${token}`);

             // The search filters by user email first, then by query.
             // If filteredOrders is empty, it returns 404.
             expect(res.statusCode).toBe(404);
        });

        it('should find other users orders if user is admin', async () => {
             const email = 'admin1@example.com';
             db.data.users['admin1'] = { email, username: 'admin1', role: 'admin' };
             db.data.emailIndex = { [email]: 'admin1' };
             const secret123 = '550e8400-e29b-41d4-a716-446655440012';
             db.data.orders[secret123] = { orderId: secret123, billingContact: { email: 'customer@example.com' } };
             await db.write();
             rebuildIndex();

             const token = getAuthToken('admin1', email, 'admin');
             const res = await request(app)
                .get('/api/orders/search?q=0012')
                .set('Authorization', `Bearer ${token}`);

             expect(res.statusCode).toBe(200);
             expect(res.body[0].orderId).toBe(secret123);
        });

        it('should return 404 if no order matches', async () => {
            const email = 'search@example.com';
            db.data.users['searchuser'] = { email, username: 'searchuser' };
            db.data.emailIndex = { [email]: 'searchuser' };
            await db.write();
            rebuildIndex();

            const token = getAuthToken('searchuser', email);
            const res = await request(app)
                .get('/api/orders/search?q=nonexistent')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(404);
        });
    });

    describe('POST /api/orders/:orderId/status - HOLD_FOR_PICKUP', () => {
        it('should transition order to HOLD_FOR_PICKUP and record holdForPickupAt', async () => {
            const adminEmail = 'admin_pickup@example.com';
            db.data.users['admin_pickup'] = { email: adminEmail, username: 'admin_pickup', role: 'admin' };
            db.data.emailIndex = { [adminEmail]: 'admin_pickup' };
            const orderId = '550e8400-e29b-41d4-a716-446655440099';
            db.data.orders[orderId] = {
                orderId,
                status: 'PRINTING',
                deliveryMethod: 'pickup',
                billingContact: { email: 'pickup_customer@example.com', givenName: 'Jane', familyName: 'Doe' },
                shippingContact: { givenName: 'Jane', familyName: 'Doe' }
            };
            await db.write();
            rebuildIndex();

            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;
            const token = getAuthToken('admin_pickup', adminEmail, 'admin');
            const res = await agent
                .post(`/api/orders/${orderId}/status`)
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .send({ status: 'HOLD_FOR_PICKUP' });

            expect(res.statusCode).toBe(200);
            expect(res.body.order.status).toBe('HOLD_FOR_PICKUP');
            expect(db.data.orders[orderId].status).toBe('HOLD_FOR_PICKUP');
            expect(db.data.orders[orderId].holdForPickupAt).toBeDefined();
        });
    });

    describe('Non-Volatile Audit Logging & 30-Day Retention Flush', () => {
        const adminEmail = 'admin_audit@example.com';
        const adminToken = () => getAuthToken('admin_audit', adminEmail, 'admin');

        beforeEach(async () => {
            db.data.users['admin_audit'] = { email: adminEmail, username: 'admin_audit', role: 'admin' };
            db.data.emailIndex = { [adminEmail]: 'admin_audit' };
            await db.write();
            rebuildIndex();
        });

        it('should record order transition history and actor when status changes', async () => {
            const orderId = '550e8400-e29b-41d4-a716-446655440201';
            db.data.orders[orderId] = {
                orderId,
                status: 'NEW',
                billingContact: { email: 'customer1@example.com', givenName: 'Alice', familyName: 'Smith' },
                shippingContact: { givenName: 'Alice', familyName: 'Smith' },
                amount: 1500
            };
            await db.write();

            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const res = await agent
                .post(`/api/orders/${orderId}/status`)
                .set('Authorization', `Bearer ${adminToken()}`)
                .set('X-CSRF-Token', csrfRes.body.csrfToken)
                .send({ status: 'ACCEPTED', note: 'Checked cutlines' });

            expect(res.statusCode).toBe(200);
            expect(res.body.order.status).toBe('ACCEPTED');

            const orderInDb = db.data.orders[orderId];
            expect(orderInDb.statusHistory).toBeDefined();
            expect(orderInDb.statusHistory.length).toBeGreaterThanOrEqual(1);

            const lastEvent = orderInDb.statusHistory[orderInDb.statusHistory.length - 1];
            expect(lastEvent.fromStatus).toBe('NEW');
            expect(lastEvent.toStatus).toBe('ACCEPTED');
            expect(lastEvent.actor.type).toBe('admin');
            expect(lastEvent.actor.id).toBe('admin_audit');
            expect(lastEvent.note).toBe('Checked cutlines');
        });

        it('should mark shadowDeleted: true and shadowDeletedAt when status is CANCELED, and clear them upon recovery', async () => {
            const orderId = '550e8400-e29b-41d4-a716-446655440202';
            db.data.orders[orderId] = {
                orderId,
                status: 'NEW',
                billingContact: { email: 'customer2@example.com', givenName: 'Bob', familyName: 'Jones' },
                shippingContact: { givenName: 'Bob', familyName: 'Jones' },
                amount: 2000
            };
            await db.write();

            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');

            // Cancel
            const cancelRes = await agent
                .post(`/api/orders/${orderId}/status`)
                .set('Authorization', `Bearer ${adminToken()}`)
                .set('X-CSRF-Token', csrfRes.body.csrfToken)
                .send({ status: 'CANCELED', note: 'Customer requested refund' });

            expect(cancelRes.statusCode).toBe(200);
            expect(db.data.orders[orderId].shadowDeleted).toBe(true);
            expect(db.data.orders[orderId].shadowDeletedAt).toBeDefined();

            // Recover to ACCEPTED
            const recoverRes = await agent
                .post(`/api/orders/${orderId}/status`)
                .set('Authorization', `Bearer ${adminToken()}`)
                .set('X-CSRF-Token', csrfRes.body.csrfToken)
                .send({ status: 'ACCEPTED' });

            expect(recoverRes.statusCode).toBe(200);
            expect(db.data.orders[orderId].shadowDeleted).toBe(false);
            expect(db.data.orders[orderId].shadowDeletedAt).toBeNull();
        });

        it('should return full order history via GET /api/orders/:orderId/history', async () => {
            const orderId = '550e8400-e29b-41d4-a716-446655440203';
            db.data.orders[orderId] = {
                orderId,
                status: 'NEW',
                billingContact: { email: 'customer3@example.com', givenName: 'Carol', familyName: 'White' },
                shippingContact: { givenName: 'Carol', familyName: 'White' },
                amount: 1000,
                statusHistory: [
                    { eventId: 'evt_1', timestamp: new Date().toISOString(), fromStatus: null, toStatus: 'NEW', actor: { type: 'customer', id: 'customer3@example.com' } }
                ]
            };
            await db.write();

            const agent = request.agent(app);
            const res = await agent
                .get(`/api/orders/${orderId}/history`)
                .set('Authorization', `Bearer ${adminToken()}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.orderId).toBe(orderId);
            expect(Array.isArray(res.body.history)).toBe(true);
            expect(res.body.history.length).toBeGreaterThanOrEqual(1);
        });

        it('should get and update retention config via GET/POST /api/admin/retention/config', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');

            // GET
            const getRes = await agent
                .get('/api/admin/retention/config')
                .set('Authorization', `Bearer ${adminToken()}`);
            expect(getRes.statusCode).toBe(200);
            expect(getRes.body.retentionDays).toBe(30);

            // POST
            const postRes = await agent
                .post('/api/admin/retention/config')
                .set('Authorization', `Bearer ${adminToken()}`)
                .set('X-CSRF-Token', csrfRes.body.csrfToken)
                .send({ purgeArtworkOnFlush: true });

            expect(postRes.statusCode).toBe(200);
            expect(postRes.body.retention.purgeArtworkOnFlush).toBe(true);

            // Re-check GET
            const checkRes = await agent
                .get('/api/admin/retention/config')
                .set('Authorization', `Bearer ${adminToken()}`);
            expect(checkRes.body.purgeArtworkOnFlush).toBe(true);
        });

        it('should retain canceled orders < 30 days and purge canceled orders >= 30 days', async () => {
            const recentCanceledId = '550e8400-e29b-41d4-a716-446655440204';
            const expiredCanceledId = '550e8400-e29b-41d4-a716-446655440205';

            const now = Date.now();
            const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
            const thirtyFiveDaysAgo = new Date(now - 35 * 24 * 60 * 60 * 1000).toISOString();

            db.data.orders[recentCanceledId] = {
                orderId: recentCanceledId,
                status: 'CANCELED',
                shadowDeleted: true,
                shadowDeletedAt: tenDaysAgo,
                billingContact: { email: 'recent@example.com' },
                amount: 1200
            };

            db.data.orders[expiredCanceledId] = {
                orderId: expiredCanceledId,
                status: 'CANCELED',
                shadowDeleted: true,
                shadowDeletedAt: thirtyFiveDaysAgo,
                billingContact: { email: 'expired@example.com' },
                amount: 2500
            };
            await db.write();

            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');

            const flushRes = await agent
                .post('/api/admin/retention/flush')
                .set('Authorization', `Bearer ${adminToken()}`)
                .set('X-CSRF-Token', csrfRes.body.csrfToken)
                .send({ retentionDays: 30 });

            expect(flushRes.statusCode).toBe(200);
            expect(flushRes.body.flushedCount).toBe(1);
            expect(flushRes.body.flushedOrderIds).toContain(expiredCanceledId);

            // Recent order remains
            expect(db.data.orders[recentCanceledId]).toBeDefined();
            // Expired order is deleted from DB
            expect(db.data.orders[expiredCanceledId]).toBeUndefined();
        });
    });
});

