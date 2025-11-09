
import request from 'supertest';
import { startServer } from '../server/server.js';
import jwt from 'jsonwebtoken';
import { getCurrentSigningKey } from '../server/keyManager.js';
import { jest } from '@jest/globals';

// Mock the Square client to avoid actual API calls
const mockSquareClient = {
    paymentsApi: {
        createPayment: jest.fn().mockResolvedValue({
            result: {
                payment: {
                    id: 'mock-payment-id',
                    orderId: 'mock-square-order-id',
                },
            },
        }),
    },
};

describe('Quantity Validation Vulnerabilities', () => {
    let app, server, authToken;

    beforeAll(async () => {
        const { app: serverApp, server: httpServer } = await startServer(null, mockSquareClient, null, null, 3001);
        app = serverApp;
        server = httpServer;

        // Generate a valid JWT for an authenticated user
        const { privateKey, kid } = getCurrentSigningKey();
        authToken = jwt.sign({ username: 'test-user', email: 'test@example.com' }, privateKey, {
            algorithm: 'RS256',
            expiresIn: '1h',
            header: { kid },
        });
    });

    afterAll((done) => {
        server.close(done);
    });

    const createOrderPayload = (quantity) => ({
        sourceId: 'cnon:card-nonce-ok',
        amountCents: 1000,
        currency: 'USD',
        designImagePath: '/uploads/mock-design.png',
        orderDetails: {
            quantity: quantity,
            material: 'pp_standard',
        },
        billingContact: {
            givenName: 'Test',
            familyName: 'User',
            email: 'test@example.com',
        },
    });

    test('BLF-002: should reject orders with a fractional quantity', async () => {
        const payload = createOrderPayload(0.5); // Fractional quantity

        const response = await request(app)
            .post('/api/create-order')
            .set('Authorization', `Bearer ${authToken}`)
            .send(payload);

        expect(response.statusCode).toBe(400);
        expect(response.body.errors[0].msg).toContain('Order quantity must be a positive integer');
    });

    test('BLF-003: should reject orders with a negative quantity', async () => {
        const payload = createOrderPayload(-1); // Negative quantity

        const response = await request(app)
            .post('/api/create-order')
            .set('Authorization', `Bearer ${authToken}`)
            .send(payload);

        expect(response.statusCode).toBe(400);
        expect(response.body.errors[0].msg).toContain('Order quantity must be a positive integer');
    });
});
