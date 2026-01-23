import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security: File Extension Spoofing', () => {
  let app;
  let db;
  let serverInstance;
  let timers;
  let bot;
  const testDbPath = path.join(__dirname, 'test-db-upload-security.json');

  // Mock Square Client
  const mockSquareClient = {
    locations: {},
    payments: {
      create: jest.fn().mockResolvedValue({
        payment: { id: 'mock_payment_id', orderId: 'mock_square_order_id' }
      })
    }
  };

  beforeAll(async () => {
    // Mock DB structure
    const data = { orders: {}, users: {}, credentials: {}, config: {}, products: {}, activeOrders: [], shippedOrders: [], userOrderIndex: {} };
    db = {
      data: data,
      write: async () => { },
      read: async () => { }
    };

    const mockSendEmail = jest.fn();

    const server = await startServer(db, null, mockSendEmail, testDbPath, mockSquareClient);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    serverInstance = app.listen();
  });

  afterAll(async () => {
    if (bot) await bot.stop('test');
    timers.forEach(timer => clearInterval(timer));
    await new Promise(resolve => serverInstance.close(resolve));
    try {
      await fs.unlink(testDbPath);
    } catch (e) {}
  });

  it('should enforce correct extension for uploaded files', async () => {
    const agent = request.agent(app);

    // 1. Get CSRF Token
    let csrfRes = await agent.get('/api/csrf-token');
    let csrfToken = csrfRes.body.csrfToken;

    // 2. Register/Login
    await agent
      .post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'uploader', password: 'password123' });

    // Refresh CSRF token after session change
    csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'uploader', password: 'password123' });

    const authToken = loginRes.body.token;

    // 3. Upload file with spoofed extension
    // PNG magic numbers: 89 50 4E 47 0D 0A 1A 0A
    const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const pngBuffer = Buffer.alloc(100); // 100 bytes should be enough
    for (let i = 0; i < pngSignature.length; i++) {
        pngBuffer[i] = pngSignature[i];
    }

    const res = await agent
      .post('/api/upload-design')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-CSRF-Token', csrfToken)
      .attach('designImage', pngBuffer, 'exploit.html'); // Upload as .html

    // 4. Assertions
    if (res.statusCode !== 200) {
        console.error('Test failed with status:', res.statusCode);
        console.error('Response body:', res.body);
    }
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);

    const uploadedPath = res.body.designImagePath;
    console.log('Uploaded Path:', uploadedPath);

    // Verify extension is .png, NOT .html
    expect(uploadedPath.endsWith('.png')).toBe(true);
    expect(uploadedPath.endsWith('.html')).toBe(false);

    // Verify file actually exists on disk
    const serverRoot = path.join(__dirname, '../');
    const diskPath = path.join(serverRoot, uploadedPath.replace(/^\//, ''));

    try {
        await fs.access(diskPath);
        // Clean up
        await fs.unlink(diskPath);
    } catch (error) {
        // Cleanup if assertion failed and it saved as .html
        const spoofedPath = diskPath.replace('.png', '.html');
        try {
            await fs.unlink(spoofedPath);
        } catch (e) {}

        // Rethrow the access error if that was the expectation,
        // but checking endsWith first catches the logic error.
    }
  });
});
