
import request from 'supertest';
import { jest } from '@jest/globals';
import { startServer } from '../server.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock dependencies
const mockSquareClient = {
  locations: {},
  payments: {
    create: jest.fn().mockResolvedValue({
      payment: {
        id: 'payment_123',
        orderId: 'order_123',
        status: 'COMPLETED'
      }
    })
  }
};

const mockBot = {
  telegram: {
    sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
    sendPhoto: jest.fn().mockResolvedValue({ message_id: 124 }),
    sendDocument: jest.fn().mockResolvedValue({ message_id: 125 })
  }
};

const mockSendEmail = jest.fn().mockResolvedValue({});

describe('Security: Type Confusion', () => {
  let app;
  let server;
  let db;
  let token;

  const testDbPath = path.join(__dirname, 'test_db_type_confusion.json');

  beforeAll(async () => {
    // Setup generic DB
    db = await JSONFilePreset(testDbPath, {
        orders: {},
        users: {
            'testuser': {
                id: 'testuser',
                username: 'testuser',
                email: 'test@example.com',
                password: 'hashedpassword',
                role: 'user'
            }
        },
        products: {}
    });

    // Start server
    const serverInstance = await startServer(db, mockBot, mockSendEmail, testDbPath, mockSquareClient);
    app = serverInstance.app;
    server = serverInstance;

    // Get CSRF Token
    const csrfRes = await request(app).get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;
    const csrfHeader = { 'X-CSRF-Token': csrfToken, 'Cookie': csrfRes.headers['set-cookie'] };

    // Register a user.
    await request(app)
        .post('/api/auth/register-user')
        .set(csrfHeader)
        .send({
            username: 'testattacker',
            password: 'password123'
        });

    const loginRes = await request(app)
        .post('/api/auth/login')
        .set(csrfHeader)
        .send({
            username: 'testattacker',
            password: 'password123'
        });
    token = loginRes.body.token;

    // We also need CSRF token for the create-order request
    // Since we reuse the app instance, the cookie should persist if we were using a real agent,
    // but here we might need to send it again.
    // Actually, create-order validates CSRF too.
  });

  afterAll(async () => {
    if (server && server.timers) {
        server.timers.forEach(t => clearInterval(t));
    }
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('should reject non-string sourceId in /api/create-order', async () => {
    // Get CSRF Token (fresh one or reuse?)
    // Reusing the one from beforeAll might be tricky if session/cookie logic is involved.
    // Let's fetch a fresh one.
    const csrfRes = await request(app).get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;
    const csrfHeader = { 'X-CSRF-Token': csrfToken, 'Cookie': csrfRes.headers['set-cookie'] };

    // Create a dummy image file for validation
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    // Write a valid 1x1 pixel PNG to avoid dependency on external files
    const minimalPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path.join(uploadDir, 'test.png'), minimalPng);

    const res = await request(app)
      .post('/api/create-order')
      .set('Authorization', `Bearer ${token}`)
      .set(csrfHeader)
      .send({
        sourceId: { malicious: 'object' }, // Type Confusion
        amountCents: 1000,
        currency: 'USD',
        designImagePath: '/uploads/test.png',
        orderDetails: {
            quantity: 1,
            material: 'pp_standard',
            resolution: 'dpi_300'
        },
        billingContact: {
            givenName: 'Test',
            email: 'test@example.com'
        },
        shippingContact: {
            givenName: 'Test',
            addressLines: ['123 Main St'],
            locality: 'City',
            administrativeDistrictLevel1: 'State',
            postalCode: '12345',
            country: 'US'
        }
      });

    // Cleanup
    fs.unlinkSync(path.join(uploadDir, 'test.png'));

    // We expect 400 Bad Request due to validation error
    // The goal is to enforce string type for sourceId.

    expect(res.status).toBe(400);
    // Check if error specifically mentions sourceId validation failure
    // express-validator returns { errors: [ ... ] }
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          msg: 'sourceId must be a string'
        })
      ])
    );
  });
});
