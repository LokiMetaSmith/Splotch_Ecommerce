import request from 'supertest';
import { startServer } from './server.js';
import { initializeBot } from './bot.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('API Endpoints', () => {
    let app;
    let db;
    const testDbPath = path.join(__dirname, 'test-db.json');

    beforeAll(async () => {
        // Reset the test database before each test
        await fs.writeFile(testDbPath, JSON.stringify({ orders: [], users: {}, credentials: {}, config: {} }));
        db = await JSONFilePreset(testDbPath, { orders: [], users: {}, credentials: {}, config: {} });
        const bot = initializeBot(db);
        app = await startServer(db, bot, testDbPath);
    });

    afterAll(async () => {
        // Clean up the test database file
        await fs.unlink(testDbPath);
    });

    describe('Auth Endpoints', () => {
        it('should pre-register a new user and return registration options', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;

            const res = await agent
                .post('/api/auth/pre-register')
                .set('x-csrf-token', csrfToken)
                .send({ username: 'testuser' });

            expect(res.statusCode).toEqual(200);
            expect(res.body.challenge).toBeDefined();

            await db.read();
            expect(db.data.users.testuser).toBeDefined();
        });

        it('should login an existing user with correct credentials', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;

            // First, create a user with a hashed password
            const hashedPassword = await bcrypt.hash('testpassword', 10);
            db.data.users['testuser'] = {
                id: 'some-random-id',
                username: 'testuser',
                password: hashedPassword,
                credentials: []
            };
            await db.write();

            const res = await agent
                .post('/api/auth/login')
                .set('x-csrf-token', csrfToken)
                .send({ username: 'testuser', password: 'testpassword' });

            expect(res.statusCode).toEqual(200);
            expect(res.body.token).toBeDefined();
        });


        it('should not login with a wrong password', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;

            // First, create a user with a hashed password
            const hashedPassword = await bcrypt.hash('testpassword', 10);
            db.data.users['testuser'] = {
                id: 'some-random-id',
                username: 'testuser',
                password: hashedPassword,
                credentials: []
            };
            await db.write();

            const res = await agent
                .post('/api/auth/login')
                .set('x-csrf-token', csrfToken)
                .send({ username: 'testuser', password: 'wrongpassword' });

            expect(res.statusCode).toEqual(400);
            expect(res.body.error).toEqual('Invalid username or password');
        });
    });

    describe('Order Endpoints', () => {
        it('should create an order with billing and shipping addresses', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;

            const res = await agent
                .post('/api/create-order')
                .set('x-csrf-token', csrfToken)
                .send({
                    sourceId: 'cnon:card-nonce-ok',
                    amountCents: 1000,
                    currency: 'USD',
                    designImagePath: '/path/to/image.svg',
                    billingContact: {
                        givenName: 'John',
                        familyName: 'Doe',
                        email: 'john.doe@example.com'
                    },
                    shippingContact: {
                        givenName: 'Jane',
                        familyName: 'Doe',
                        email: 'jane.doe@example.com'
                    }
                });

            expect(res.statusCode).toEqual(201);
            expect(res.body.order.billingContact.givenName).toEqual('John');
            expect(res.body.order.shippingContact.givenName).toEqual('Jane');

            await db.read();
            const order = db.data.orders[0];
            expect(order.billingContact.givenName).toEqual('John');
            expect(order.shippingContact.givenName).toEqual('Jane');
        });

        it('should get all orders', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;

            const res = await agent
                .get('/api/orders')
                .set('x-csrf-token', csrfToken)

            expect(res.statusCode).toEqual(200);
            expect(res.body).toEqual([]);
        });

        it('should update the status of an order', async () => {
            const agent = request.agent(app);
            const csrfRes = await agent.get('/api/csrf-token');
            const csrfToken = csrfRes.body.csrfToken;

            const orderId = 'test-order-id';
            db.data.orders.push({
                orderId: orderId,
                status: 'NEW'
            });
            await db.write();

            const res = await agent
                .post(`/api/orders/${orderId}/status`)
                .set('x-csrf-token', csrfToken)
                .send({ status: 'ACCEPTED' });

            expect(res.statusCode).toEqual(200);
            expect(res.body.order.status).toEqual('ACCEPTED');

            await db.read();
            const order = db.data.orders[0];
            expect(order.status).toEqual('ACCEPTED');
        });
    });
});
