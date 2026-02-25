import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { startServer } from '../server.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { LowDbAdapter } from '../database/lowdb_adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to wait for server to start
const waitFor = (ms) => new Promise(r => setTimeout(r, ms));

describe('Security: Uploads CSP', () => {
  let app;
  let serverInstance;
  let timers;
  let bot;
  const testDbPath = path.join(__dirname, 'test-db-uploads-csp.json');
  const uploadsDir = path.join(__dirname, '../uploads');
  const testFileName = 'test-csp.svg';
  const testFile = path.join(uploadsDir, testFileName);

  beforeAll(async () => {
    // Ensure uploads directory exists
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    // Create a dummy SVG file
    fs.writeFileSync(testFile, '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" /></svg>');

    // Mock DB (minimal)
    const mockLowDb = {
        data: { orders: {}, users: {}, credentials: {}, config: {}, products: {}, emailIndex: {} },
        write: async () => {},
        read: async () => {}
    };
    const db = new LowDbAdapter(mockLowDb);

    const mockSendEmail = jest.fn();
    const mockSquareClient = {
        locations: {},
        payments: {}
    };

    // Start server
    const server = await startServer(db, null, mockSendEmail, testDbPath, mockSquareClient);
    app = server.app;
    timers = server.timers;
    bot = server.bot;
    // We don't need app.listen() for supertest usually, but startServer returns app.
    // However, cleanup might need closing something?
    // startServer returns { app, timers, bot }
  });

  afterAll(async () => {
    // Cleanup
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
    if (bot) await bot.stop('test');
    if (timers) timers.forEach(timer => clearInterval(timer));
    // serverInstance is not used here because supertest takes 'app'
  });

  it('should serve uploaded files with strict CSP header', async () => {
    const res = await request(app).get(`/uploads/${testFileName}`);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');

    // Check for Strict CSP
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();

    // We expect 'sandbox' to be present to prevent script execution
    expect(csp).toContain('sandbox');
    // We expect 'default-src \'none\'' to block everything else by default
    expect(csp).toContain("default-src 'none'");

    // Ensure X-Content-Type-Options is nosniff
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
