import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import { startServer } from '../server/server.js';
import { initializeBot } from '../server/bot.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Server', () => {
    let app;
    let db;
    let bot;
    let serverInstance; // To hold the server instance for closing
    let timers; // To hold the timer for clearing
    const testDbPath = path.join(__dirname, 'test-db.json');

    beforeAll(async () => {
        db = await JSONFilePreset(testDbPath, { orders: [], users: {}, credentials: {}, config: {} });
        bot = initializeBot(db);
        const mockSendEmail = jest.fn();
        const mockSquareClient = {
            payments: {
                create: jest.fn().mockResolvedValue({
                    payment: {
                        id: 'test-payment-id',
                        orderId: 'test-square-order-id',
                    },
                }),
            },
        };
        const server = await startServer(db, bot, mockSendEmail, testDbPath, mockSquareClient);
        app = server.app;
        timers = server.timers;
        serverInstance = app.listen(); // Start the server
    });

    beforeEach(async () => {
        db.data = { orders: [], users: {}, credentials: {}, config: {} };
        await db.write();
    });

    afterAll(async () => {
        // Stop the bot from polling, if it's running
        if (bot && typeof bot.isPolling === 'function' && bot.isPolling()) {
            await bot.stopPolling();
        }
        // Clear timers
        timers.forEach(timer => clearInterval(timer));
        // Close the server
        await new Promise(resolve => serverInstance.close(resolve));
        // Clean up the test database file
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    it('should respond to ping', async () => {
        const res = await request(app).get('/api/ping');
        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toEqual('ok');
    });

    it('should create an order with the correct server-calculated price, ignoring client-sent price', async () => {
        // This test simulates a client-side price tampering attack (BLF-001).
        // The server should ignore the amountCents sent by the client and recalculate the price itself.

        // 1. Get a valid CSRF token from the server
        const agent = request.agent(app);
        const csrfRes = await agent.get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        expect(csrfToken).toBeDefined();

        // 2. Get a temporary auth token for a test user
        const tokenRes = await agent
            .post('/api/auth/issue-temp-token')
            .set('x-csrf-token', csrfToken)
            .send({ email: 'test@example.com' });
        const authToken = tokenRes.body.token;
        expect(authToken).toBeDefined();

        // 3. Define the order payload with a tampered price
        const orderPayload = {
            sourceId: 'cnon:card-nonce-ok',
            amountCents: 1, // Maliciously low price (1 cent)
            currency: 'USD',
            designImagePath: '/uploads/test-design.svg',
            shippingContact: {
                givenName: "Test",
                familyName: "User",
                email: "test@example.com",
                addressLines: ["123 Main St"],
                locality: "Anytown",
                administrativeDistrictLevel1: "CA",
                postalCode: "12345",
                country: "US"
            },
            orderDetails: {
                quantity: 100,
                material: 'pp_standard', // Use a valid material from pricing.json
                resolution: '300 DPI (Standard)', // Use a valid resolution from pricing.json
            },
            // The following details are used for the server-side calculation.
            // We need a dummy design file for the server to read.
            // Calculation based on pricing.json and a 288x288 pixel SVG:
            // PPI for '300 DPI (Standard)' = 300.
            // Size in inches = 288px / 300ppi = 0.96 inches.
            // Area = 0.96 * 0.96 = 0.9216 sq inches.
            // Base Price = 0.9216 sq in * 15 cents/sq in = 13.824 cents.
            // Price before multipliers = 13.824 * 100 quantity = 1382.4 cents.
            // Resolution Multiplier ('300 DPI') = 1.3.
            // Material Multiplier ('pp_standard') = 1.0.
            // Total = 1382.4 * 1.3 * 1.0 = 1797.12 cents.
            // Final Rounded Price = 1797 cents.
            expectedPrice: 1797,
        };

        // Create a dummy design file for the test. 288px width/height.
        const designFilePath = path.join(__dirname, '../server/uploads/test-design.svg');
        fs.writeFileSync(designFilePath, '<svg width="288" height="288" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h288v288H0z"/></svg>');

        // 4. Send the malicious order request
        const res = await agent
            .post('/api/create-order')
            .set('Authorization', `Bearer ${authToken}`)
            .set('x-csrf-token', csrfToken)
            .send(orderPayload);

        // 5. Assertions
        expect(res.statusCode).toEqual(201);
        expect(db.data.orders).toHaveLength(1);
        const createdOrder = db.data.orders[0];

        // This is the core assertion. It checks that the price stored in the database
        // is the CORRECT, server-calculated price, not the tampered one.
        expect(createdOrder.amount).toEqual(orderPayload.expectedPrice);
        expect(createdOrder.amount).not.toEqual(orderPayload.amountCents);

        // Clean up the dummy file
        fs.unlinkSync(designFilePath);
    });
});
