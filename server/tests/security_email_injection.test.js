
import { jest } from '@jest/globals';
import request from 'supertest';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock dependencies
const mockSendEmail = jest.fn().mockResolvedValue(true);
const mockBot = {
  telegram: {
    sendMessage: jest.fn(),
    sendPhoto: jest.fn(),
    sendDocument: jest.fn(),
  },
  middleware: () => (ctx, next) => next(),
};

// Mock Square Client
const mockSquareClient = {
  payments: {
    create: jest.fn(),
  },
  locations: {}, // Sanity check requirement
  paymentsApi: {}, // Sanity check requirement
};

// Mock Google
const mockOAuth2Client = {
  setCredentials: jest.fn(),
  generateAuthUrl: jest.fn(),
  credentials: { access_token: 'mock-token' }, // valid credentials
};
const mockGoogle = {
  auth: {
    OAuth2: jest.fn(() => mockOAuth2Client),
  },
};

// Set necessary env vars
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.GOOGLE_CLIENT_ID = 'mock-id';
process.env.GOOGLE_CLIENT_SECRET = 'mock-secret';
process.env.BASE_URL = 'http://localhost:3000';
process.env.SQUARE_ACCESS_TOKEN = 'mock-sq-token';
process.env.SESSION_SECRET = 'mock-session-secret';
process.env.CSRF_SECRET = '12345678901234567890123456789012';

// Mock pricing.js
jest.unstable_mockModule('../pricing.js', () => ({
  getDesignDimensions: jest.fn().mockResolvedValue({ bounds: { width: 100, height: 100 }, cutline: [] }),
  calculateStickerPrice: jest.fn().mockReturnValue({ total: 1000, complexityMultiplier: 1 }),
}));

// Import startServer dynamically to ensure mocks apply if needed
const { startServer } = await import('../server.js');

describe('Security: Email HTML Injection', () => {
  let app;
  let db;
  let serverInstance;

  beforeAll(async () => {
    const dbPath = path.join(__dirname, 'test-db-security.json');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    db = await JSONFilePreset(dbPath, { orders: {}, users: {}, emailIndex: {}, credentials: {}, config: {}, products: {} });
  });

  afterAll(async () => {
    const dbPath = path.join(__dirname, 'test-db-security.json');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (serverInstance && serverInstance.timers) {
        serverInstance.timers.forEach(t => clearInterval(t));
    }

    // Cleanup uploaded files
    const uploadDir = path.join(__dirname, '../uploads');
    if (fs.existsSync(uploadDir)) {
        const files = fs.readdirSync(uploadDir);
        for (const file of files) {
             // Only delete files that look like UUIDs created during test run if possible,
             // or just rely on the fact that this is a test env.
             // But for safety, we won't delete everything.
             // Ideally we capture the filename in the test.
        }
    }
  });

  test('should escape HTML in error messages sent via email', async () => {
    const maliciousMessage = '<script>alert("XSS")</script>';
    mockSquareClient.payments.create.mockRejectedValue(new Error(maliciousMessage));

    serverInstance = await startServer(
      db,
      mockBot,
      mockSendEmail,
      path.join(__dirname, 'test-db-security.json'),
      mockSquareClient,
      mockGoogle
    );
    app = serverInstance.app;

    // Create an agent to maintain cookies (session)
    const agent = request.agent(app);

    // 1. Get CSRF Token
    const csrfRes = await agent.get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;
    expect(csrfToken).toBeDefined();

    // 2. Register User
    const username = 'attacker';
    const password = 'password123';
    const regRes = await agent
      .post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username, password });

    if (regRes.status !== 200) {
        console.error('Register failed:', regRes.status, regRes.text);
    }

    // 3. Login
    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username, password });

    if (!loginRes.body.token) {
        console.error('Login failed:', loginRes.status, loginRes.text);
    }

    const token = loginRes.body.token;
    expect(token).toBeDefined();

    // 4. Upload Design (Dummy)
    const uploadRes = await agent
        .post('/api/upload-design')
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', csrfToken)
        .attach('designImage', Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(100)]), 'test.png');

    if (uploadRes.status !== 200) {
         console.error('Upload failed:', uploadRes.status, uploadRes.text);
    }
    const designImagePath = uploadRes.body.designImagePath;

    // 5. Create Order (Trigger Vulnerability)
    const res = await agent
      .post('/api/create-order')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        sourceId: 'cnon:card-nonce-ok',
        amountCents: 1000,
        currency: 'USD',
        designImagePath: designImagePath,
        orderDetails: {
            quantity: 10,
            material: 'pp_standard',
            resolution: 'dpi_300',
        },
        billingContact: {
            givenName: 'John',
            familyName: 'Doe',
            email: 'john@example.com'
        },
        shippingContact: {
            givenName: 'John',
            familyName: 'Doe',
            addressLines: ['123 St'],
            locality: 'City',
            administrativeDistrictLevel1: 'State',
            postalCode: '12345',
            country: 'US'
        }
      });

    // 6. Assert
    expect(res.status).toBe(500);

    expect(mockSendEmail).toHaveBeenCalled();
    const emailCall = mockSendEmail.mock.calls.find(call => call[0].subject.includes('Print Shop Server Error'));
    expect(emailCall).toBeDefined();

    const emailHtml = emailCall[0].html;
    console.log('Email HTML content:', emailHtml);

    // Check for fix (escaped script tag)
    expect(emailHtml).not.toContain(maliciousMessage);
    expect(emailHtml).toContain('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');

    // Cleanup
    if (designImagePath) {
        const fullPath = path.join(__dirname, '..', designImagePath);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
  });
});
