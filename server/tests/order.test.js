import { jest } from '@jest/globals';
import { generateKeyPairSync } from 'crypto';

// Generate a real RSA key pair for testing JWT signing
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Mock the dependencies that the server relies on
jest.unstable_mockModule('../keyManager.js', () => ({
  getCurrentSigningKey: jest.fn(() => ({
    privateKey,
    kid: 'test-kid',
    publicKey,
  })),
  getJwks: jest.fn(() => ({ keys: [] })),
  rotateKeys: jest.fn(),
}));

jest.unstable_mockModule('../bot.js', () => ({
  initializeBot: jest.fn(() => ({
    telegram: {
      sendMessage: jest.fn(),
      sendPhoto: jest.fn(),
      sendDocument: jest.fn(),
      deleteMessage: jest.fn(),
      editMessageText: jest.fn(),
    },
  })),
}));

jest.unstable_mockModule('../email.js', () => ({
  sendEmail: jest.fn(),
}));

const { startServer } = await import('../server.js');

import request from 'supertest';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// In-memory database for testing
const dbPath = path.join(__dirname, `test-db-${Date.now()}.json`);
const defaultData = {
  orders: [],
  users: {
    'testuser': {
      id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
      password: 'hashedpassword', // Not used in this test
      credentials: [],
    }
  },
  credentials: {},
  config: {}
};

// Create a mock DB file
fs.writeFileSync(dbPath, JSON.stringify(defaultData));

// Mock db to be used by the server
let db;

// Mock bot and email services
const mockBot = {
  telegram: {
    sendMessage: jest.fn(),
    sendPhoto: jest.fn(),
    sendDocument: jest.fn(),
    deleteMessage: jest.fn(),
    editMessageText: jest.fn(),
  }
};
const mockSendEmail = jest.fn();

describe('Order API Endpoints', () => {
  let app;
  let serverInstance;
  let userToken;

  beforeAll(async () => {
    // Set a dummy access token to prevent startup failure
    process.env.SQUARE_ACCESS_TOKEN = 'dummy_token';

    // Initialize the database with some test data
    db = await JSONFilePreset(dbPath, defaultData);
    await db.read();
    db.data.orders = [
      { orderId: 'order-abc-123', billingContact: { email: 'test@example.com' }, otherDetails: 'details1' },
      { orderId: 'order-def-456', billingContact: { email: 'test@example.com' }, otherDetails: 'details2' },
      { orderId: 'order-ghi-789', billingContact: { email: 'another@example.com' }, otherDetails: 'details3' },
    ];
    await db.write();

    // Start the server
    const { app: expressApp } = await startServer(db, mockBot, mockSendEmail, dbPath);
    app = expressApp;

    // Generate a token for a user that only contains a username, not an email
    // This simulates a user logged in via username/password
    const keyManager = await import('../keyManager.js');
    const { privateKey, kid } = keyManager.getCurrentSigningKey();
    userToken = jwt.sign({ username: 'testuser', email: 'test@example.com' }, privateKey, { algorithm: 'RS256', header: { kid } });
  });

  afterAll(() => {
    // Clean up the mock database file
    fs.unlinkSync(dbPath);
  });

  describe('GET /api/orders/search', () => {
    it('should return all orders for the user when no query is provided', async () => {
      const response = await request(app)
        .get('/api/orders/search')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Cookie', 'csrf-token=mock-csrf-token') // Mock CSRF token
        .set('X-CSRF-Token', 'mock-csrf-token');

      // BUG: Currently fails. It should return 200 with 2 orders.
      // Instead, it returns 404 because it searches for "undefined".
      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(2);
      expect(response.body[0].orderId).toBe('order-def-456');
    });

    it('should return a 401 error because user lookup fails without an email in JWT', async () => {
        // Generate a token with only a username, which exposes the lookup bug
        const keyManager = await import('../keyManager.js');
        const { privateKey, kid } = keyManager.getCurrentSigningKey();
        const tokenWithoutEmail = jwt.sign({ username: 'testuser' }, privateKey, { algorithm: 'RS256', header: { kid } });

        const response = await request(app)
            .get('/api/orders/search?q=abc')
            .set('Authorization', `Bearer ${tokenWithoutEmail}`)
            .set('Cookie', 'csrf-token=mock-csrf-token')
            .set('X-CSRF-Token', 'mock-csrf-token');

        // With the fix, this now correctly returns a 401 because the token is missing an email.
        // We will update the test to assert the new, more specific error message.
        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Authentication token must contain an email.');
    });

    it('should correctly find an order by its ID', async () => {
        const response = await request(app)
            .get('/api/orders/search?q=abc')
            .set('Authorization', `Bearer ${userToken}`)
            .set('Cookie', 'csrf-token=mock-csrf-token')
            .set('X-CSRF-Token', 'mock-csrf-token');

        expect(response.status).toBe(200);
        expect(response.body.length).toBe(1);
        expect(response.body[0].orderId).toBe('order-abc-123');
    });
  });
});