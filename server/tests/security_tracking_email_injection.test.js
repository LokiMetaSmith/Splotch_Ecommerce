
import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security Fix - HTML Injection in Emails', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  let mockSendEmail;
  const testDbPath = path.join(__dirname, 'test-db-security.json');

  const adminUser = {
    id: 'admin-id',
    username: 'admin',
    email: 'admin@example.com',
    role: 'admin',
    password: 'hash',
    credentials: []
  };

  const testOrder = {
    orderId: '550e8400-e29b-41d4-a716-446655440000',
    billingContact: {
      email: 'customer@example.com',
      givenName: 'John',
      familyName: 'Doe'
    },
    shippingContact: {
      givenName: 'John',
      familyName: 'Doe',
      addressLines: ['123 Main St'],
      locality: 'City',
      administrativeDistrictLevel1: 'State',
      postalCode: '12345',
      country: 'USA'
    },
    status: 'PRINTING',
    orderDetails: { quantity: 1 }
  };

  beforeAll(async () => {
    // Mock DB
    const data = {
        orders: [testOrder],
        users: { 'admin': adminUser },
        credentials: {},
        config: {}
    };

    // We need a robust mock for db that the server can use
    // The server wraps db in LowDbAdapter if it doesn't have getOrder.
    // So we can pass a simple object that looks like LowDb instance (data + write/read)
    // OR we can pass a mock adapter.
    // server/server.js: if (!db.getOrder) db = new LowDbAdapter(db);
    // So passing { data, write, read } works and it gets wrapped.

    db = {
      data: data,
      write: jest.fn(),
      read: jest.fn()
    };

    mockSendEmail = jest.fn();

    // We need to inject secrets? verify-token needs keys.
    // server/keyManager.js handles keys.

    // We need to make sure isAdmin checks pass.
    // isAdmin uses getUserByEmail or db.getUser.
    // Our mock db.data has the admin user. LowDbAdapter.getUser will find it.

    // Inject ADMIN_EMAIL to match
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.STORAGE_PROVIDER = 'local';
    process.env.SESSION_SECRET = 'test-secret';
    process.env.CSRF_SECRET = '12345678901234567890123456789012';

    const server = await startServer(db, null, mockSendEmail, testDbPath);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    serverInstance = app.listen();
  });

  afterAll(async () => {
    if (bot) await bot.stop('test');
    timers.forEach(timer => clearInterval(timer));
    await new Promise(resolve => serverInstance.close(resolve));
    try { await fs.unlink(testDbPath); } catch (error) {
        // Ignore error if file doesn't exist
    }
  });

  it('should escape HTML in tracking number and courier in emails', async () => {
    const agent = request.agent(app);

    // 1. Login as admin
    const csrfRes = await agent.get('/api/csrf-token');
    const csrfToken = csrfRes.body.csrfToken;

    // We can't easily login via /api/auth/login because of bcrypt hash.
    // But we can Mock the login flow or simpler: use a custom mock token?
    // server.js checks signature.

    // Alternative: Login normally.
    // I need to hash the password in the mock DB.
    // DUMMY_HASH is used in server.js but imported not exported.

    // Actually, I can use `authenticateToken` middleware mocking? No, integration test.

    // Let's create a user via register-user first?
    // No, I want to be admin.

    // Wait, `server/auth.test.js` uses `request.agent(app)`.
    // I can just request the endpoint with a valid token.
    // How to get a valid token?
    // 1. Register a user (admin candidate).
    // 2. Login to get token.
    // 3. But I need to make them admin.
    // server.js `isAdmin` checks `user.role === 'admin'`.
    // So I register, then I manually update the DB to make them admin.

    // Register
    await agent.post('/api/auth/register-user')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'realadmin', password: 'password123' });

    // Update DB to make 'realadmin' an admin
    // db is wrapped by adapter inside server, but we hold reference to inner db?
    // server.js: db = new LowDbAdapter(db);
    // The inner db.data is modified.

    // const user = db.data.users['realadmin'];
    // Depending on structure. Adapter might change structure.
    // LowDbAdapter converts array to object?
    // Let's check db.data structure after server start.

    // Assuming we can find the user and set role='admin'
    // But wait, `db` variable in `startServer` is local.
    // But we passed `db` object. JavaScript passes objects by reference.
    // So `db.data` should be accessible.

    // However, LowDbAdapter might have replaced `db.data` reference if it did migration?

    // Let's login first.
    const loginRes = await agent.post('/api/auth/login')
        .set('X-CSRF-Token', csrfToken)
        .send({ username: 'realadmin', password: 'password123' });

    const token = loginRes.body.token;
    expect(token).toBeDefined();

    // Now hack the DB to make them admin
    // The LowDbAdapter stores users in `db.data.users` keyed by username or in an array?
    // server.js defaultData = { users: {} }
    // LowDbAdapter likely keeps it as object or array.

    // Let's verify by checking users
    let userObj = null;
    if (Array.isArray(db.data.users)) {
         userObj = db.data.users.find(u => u.username === 'realadmin');
    } else {
         // It might be keyed by ID or Username
         // LowDbAdapter usually keeps whatever structure.
         // Let's assume object keyed by something or check values
         userObj = Object.values(db.data.users).find(u => u.username === 'realadmin');
    }

    if (userObj) {
        userObj.role = 'admin';
        // Need to ensure db.getUser sees this.
    } else {
        throw new Error('Could not find user in mock DB');
    }

    // Now call the vulnerable endpoint
    // WAF blocks <script>, but we want to prove HTML injection is possible for other tags
    const maliciousPayload = {
        trackingNumber: '<b>BOLD</b>',
        courier: '<a href="http://evil.com">Click Me</a>'
    };

    const res = await agent.post('/api/orders/550e8400-e29b-41d4-a716-446655440000/tracking')
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', csrfToken)
        .send(maliciousPayload);

    expect(res.status).toBe(200);

    // Verify email content
    expect(mockSendEmail).toHaveBeenCalled();

    const calls = mockSendEmail.mock.calls;
    const trackingEmailCall = calls.find(call => call[0].subject && call[0].subject.includes('shipped'));

    expect(trackingEmailCall).toBeDefined();
    const emailHtml = trackingEmailCall[0].html;

    console.log('Tracking Email HTML:', emailHtml);

    // FIX CONFIRMATION:
    // The code should now escape HTML.
    expect(emailHtml).not.toContain('<b>BOLD</b>');
    expect(emailHtml).not.toContain('<a href="http://evil.com">Click Me</a>');

    expect(emailHtml).toContain('&lt;b&gt;BOLD&lt;/b&gt;');
    expect(emailHtml).toContain('&lt;a href=&quot;http://evil.com&quot;&gt;Click Me&lt;/a&gt;');
  });
});
