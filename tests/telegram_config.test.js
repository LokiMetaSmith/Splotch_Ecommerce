import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import { startServer } from '../server/server.js';
import { initializeBot } from '../server/bot.js';
import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import fs from 'fs';
import {
  getTelegramConfig,
  checkStalledOrders,
  DEFAULT_TELEGRAM_CONFIG,
} from '../server/lib/telegramReminder.js';
import {
  formatOrderPrintDetails,
  getOrderJobUrl,
  getOrderStatusKeyboard,
} from '../server/telegramHelpers.js';
import {
  sendNewOrderNotification,
  updateOrderStatusNotification,
} from '../server/notificationLogic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Telegram Bot Alert Cadence Configuration & Stalled Orders', () => {
  let app;
  let db;
  let dbAdapter;
  let bot;
  let serverInstance;
  let timers;
  const testDbPath = path.join(__dirname, 'test-db-telegram-config.json');
  let adminToken;
  let nonAdminToken;
  let csrfToken;
  let agent;

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'mock-token';
    process.env.TELEGRAM_CHANNEL_ID = 'mock-channel';

    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    db = await JSONFilePreset(testDbPath, {
      orders: {},
      users: {},
      credentials: {},
      config: {},
    });

    bot = initializeBot(db);
    bot.telegram.deleteMessage = jest.fn().mockResolvedValue(true);
    bot.telegram.editMessageText = jest.fn().mockResolvedValue(true);
    bot.telegram.sendMessage = jest.fn().mockResolvedValue({ message_id: 777 });

    const mockSendEmail = jest.fn();
    const server = await startServer(db, bot, mockSendEmail, testDbPath);
    app = server.app;
    dbAdapter = server.db;
    timers = server.timers;
    serverInstance = app.listen();

    agent = request.agent(app);

    // Get CSRF Token
    const csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.csrfToken;

    // Register admin user
    await agent
      .post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'admin_tg', password: 'password123' });

    await db.read();
    const adminUser = Object.values(db.data.users).find(u => u.username === 'admin_tg');
    adminUser.role = 'admin';
    adminUser.email = 'admin_tg@example.com';
    if (!db.data.emailIndex) db.data.emailIndex = {};
    db.data.emailIndex['admin_tg@example.com'] = 'admin_tg';
    await db.write();

    const adminLoginRes = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'admin_tg', password: 'password123' });
    adminToken = adminLoginRes.body.token;

    // Register regular user
    await agent
      .post('/api/auth/register-user')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'regular_tg', password: 'password123' });

    const userLoginRes = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'regular_tg', password: 'password123' });
    nonAdminToken = userLoginRes.body.token;
  });

  afterAll(async () => {
    if (timers) timers.forEach(timer => clearInterval(timer));
    if (serverInstance) await new Promise(resolve => serverInstance.close(resolve));
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  describe('API Endpoints: /api/admin/telegram/config', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/admin/telegram/config');
      expect(res.status).toBe(401);
    });

    it('should reject non-admin users with 403', async () => {
      const res = await request(app)
        .get('/api/admin/telegram/config')
        .set('Authorization', `Bearer ${nonAdminToken}`);
      expect(res.status).toBe(403);
    });

    it('should return default telegram config for admin', async () => {
      const res = await request(app)
        .get('/api/admin/telegram/config')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        enabled: true,
        stalledThresholdHours: 4,
        checkIntervalMinutes: 60,
        repeatReminderHours: 0,
      });
    });

    it('should validate inputs on POST /api/admin/telegram/config', async () => {
      // Invalid enabled
      const res1 = await agent
        .post('/api/admin/telegram/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ enabled: 'invalid' });
      expect(res1.status).toBe(400);

      // Invalid threshold
      const res2 = await agent
        .post('/api/admin/telegram/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ stalledThresholdHours: -5 });
      expect(res2.status).toBe(400);

      // Invalid interval
      const res3 = await agent
        .post('/api/admin/telegram/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ checkIntervalMinutes: 0 });
      expect(res3.status).toBe(400);

      // Invalid repeat
      const res4 = await agent
        .post('/api/admin/telegram/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ repeatReminderHours: -1 });
      expect(res4.status).toBe(400);
    });

    it('should successfully update and persist telegram config', async () => {
      const payload = {
        enabled: true,
        stalledThresholdHours: 2,
        checkIntervalMinutes: 15,
        repeatReminderHours: 8,
      };

      const res = await agent
        .post('/api/admin/telegram/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.telegram).toEqual(payload);

      // Verify GET returns the updated config
      const getRes = await request(app)
        .get('/api/admin/telegram/config')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body).toEqual(payload);
    });
  });

  describe('Stalled Orders Checker Logic', () => {
    it('should skip sending notifications when disabled', async () => {
      // Disable in DB
      await db.read();
      db.data.config.telegram = {
        enabled: false,
        stalledThresholdHours: 1,
        checkIntervalMinutes: 15,
        repeatReminderHours: 0,
      };
      // Insert a stalled order
      const orderId = 'stalled-disabled-1';
      db.data.orders[orderId] = {
        orderId,
        status: 'NEW',
        receivedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      };
      await db.write();

      bot.telegram.sendMessage.mockClear();

      const notified = await checkStalledOrders({
        db,
        bot,
        getSecret: (k) => process.env[k],
        logger: console,
      });

      expect(notified).toEqual([]);
      expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('should notify for stalled orders when enabled and threshold is exceeded', async () => {
      await db.read();
      db.data.orders = {};
      db.data.config.telegram = {
        enabled: true,
        stalledThresholdHours: 2,
        checkIntervalMinutes: 15,
        repeatReminderHours: 0,
      };

      const stalledId = 'order-stalled-exceeded';
      const recentId = 'order-recent-active';

      db.data.orders[stalledId] = {
        orderId: stalledId,
        status: 'ACCEPTED',
        receivedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), // 3 hours ago > 2h threshold
        telegramMessageId: 1001,
      };

      db.data.orders[recentId] = {
        orderId: recentId,
        status: 'ACCEPTED',
        receivedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 mins ago < 2h threshold
        telegramMessageId: 1002,
      };

      await db.write();

      bot.telegram.sendMessage.mockClear();
      bot.telegram.sendMessage.mockResolvedValueOnce({ message_id: 888 });

      const notified = await checkStalledOrders({
        db,
        bot,
        getSecret: (k) => process.env[k],
        logger: console,
      });

      expect(notified).toContain(stalledId);
      expect(notified).not.toContain(recentId);
      expect(bot.telegram.sendMessage).toHaveBeenCalled();

      // Check order in DB has stalledMessageId and lastStalledAlertAt set
      await db.read();
      expect(db.data.orders[stalledId].stalledMessageId).toBe(888);
      expect(db.data.orders[stalledId].lastStalledAlertAt).toBeDefined();

      // Second check with repeatReminderHours = 0 should NOT re-notify
      bot.telegram.sendMessage.mockClear();
      const notifiedAgain = await checkStalledOrders({
        db,
        bot,
        getSecret: (k) => process.env[k],
        logger: console,
      });
      expect(notifiedAgain).not.toContain(stalledId);
      expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('should re-nag when repeatReminderHours > 0 and repeat interval has elapsed', async () => {
      await db.read();
      db.data.config.telegram = {
        enabled: true,
        stalledThresholdHours: 1,
        checkIntervalMinutes: 15,
        repeatReminderHours: 2, // Re-nag every 2 hours
      };

      const orderId = 'order-repeat-nag';
      db.data.orders[orderId] = {
        orderId,
        status: 'PRINTING',
        receivedAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
        stalledMessageId: 555,
        lastStalledAlertAt: Date.now() - 3 * 3600 * 1000, // alerted 3h ago (> 2h repeat cadence)
      };
      await db.write();

      bot.telegram.sendMessage.mockClear();
      bot.telegram.sendMessage.mockResolvedValueOnce({ message_id: 999 });

      const notified = await checkStalledOrders({
        db,
        bot,
        getSecret: (k) => process.env[k],
        logger: console,
      });

      expect(notified).toContain(orderId);
      expect(bot.telegram.sendMessage).toHaveBeenCalled();

      await db.read();
      expect(db.data.orders[orderId].stalledMessageId).toBe(999);
    });

    it('should clean up stalledMessageId AND lastStalledAlertAt on order status update', async () => {
      await db.read();
      const orderId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      db.data.orders[orderId] = {
        orderId,
        status: 'PRINTING',
        amount: 1500,
        currency: 'USD',
        billingContact: { email: 'user@example.com', givenName: 'Test', familyName: 'User' },
        stalledMessageId: 12345,
        lastStalledAlertAt: Date.now() - 10000,
        receivedAt: new Date().toISOString(),
      };
      await db.write();

      const res = await agent
        .post(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ status: 'SHIPPED' });

      expect(res.status).toBe(200);

      // Verify telegram deleteMessage was called
      expect(bot.telegram.deleteMessage).toHaveBeenCalledWith('mock-channel', 12345);

      // Verify db order fields cleaned
      await db.read();
      expect(db.data.orders[orderId].stalledMessageId).toBeUndefined();
      expect(db.data.orders[orderId].lastStalledAlertAt).toBeUndefined();
    });
  });

  describe('Telegram Print Settings & Job Links', () => {
    it('should format order job link properly', () => {
      const order = { orderId: 'test-uuid-1234' };
      const url = getOrderJobUrl(order, 'https://www.splotch.page');
      expect(url).toBe('https://www.splotch.page/printshop.html?orderId=test-uuid-1234');
    });

    it('should format print details including size, resolution, material, cut type and job link', () => {
      const order = {
        orderId: 'job-5678',
        orderDetails: {
          size: '3.0" × 3.0"',
          resolution: 'dpi_600',
          material: 'pp_standard',
          cutType: 'die_cut',
          customLayers: [{ id: '1' }, { id: '2' }],
        },
      };
      const text = formatOrderPrintDetails(order, 'https://www.splotch.page');

      expect(text).toContain('--- Print Settings ---');
      expect(text).toContain('📐 Size: 3.0" × 3.0"');
      expect(text).toContain('🖨 Resolution: 600 DPI');
      expect(text).toContain('🏷 Material: Standard Polypropylene');
      expect(text).toContain('✂️ Cut: Die Cut');
      expect(text).toContain('📑 Layers: 2');
      expect(text).toContain('🔗 Job Link: https://www.splotch.page/printshop.html?orderId=job-5678');
    });

    it('should calculate size from dimensions and resolution if size string is not pre-computed', () => {
      const order = {
        orderId: 'job-calculated-size',
        orderDetails: {
          dimensions: { width: 900, height: 600 },
          resolution: 'dpi_300',
          material: 'pp_holographic',
        },
      };
      const text = formatOrderPrintDetails(order, 'https://www.splotch.page');

      expect(text).toContain('📐 Size: 3.0" × 2.0"');
      expect(text).toContain('🖨 Resolution: 300 DPI');
      expect(text).toContain('🏷 Material: Holographic');
      expect(text).toContain('https://www.splotch.page/printshop.html?orderId=job-calculated-size');
    });

    it('should include print settings and job link in sendNewOrderNotification', async () => {
      const orderId = 'notif-order-1';
      await db.read();
      db.data.orders[orderId] = {
        orderId,
        status: 'NEW',
        amount: 2500,
        billingContact: { givenName: 'John', familyName: 'Doe', email: 'john@example.com' },
        orderDetails: {
          quantity: 25,
          size: '2.5" × 2.5"',
          resolution: 'dpi_300',
          material: 'vinyl',
        },
      };
      await db.write();

      bot.telegram.sendMessage.mockClear();
      bot.telegram.sendMessage.mockResolvedValueOnce({ message_id: 1111 });

      await sendNewOrderNotification(bot, dbAdapter || db, orderId);

      expect(bot.telegram.sendMessage).toHaveBeenCalled();
      const [channelId, message, extra] = bot.telegram.sendMessage.mock.calls[0];
      expect(channelId).toBe('mock-channel');
      expect(message).toContain('New Order: notif-order-1');
      expect(message).toContain('📐 Size: 2.5" × 2.5"');
      expect(message).toContain('🖨 Resolution: 300 DPI');
      expect(message).toContain('🏷 Material: Vinyl');
      expect(message).toContain('🔗 Job Link:');
      expect(message).toContain(`/printshop.html?orderId=${orderId}`);

      // Check inline keyboard has Open in Printshop button
      expect(extra?.reply_markup).toBeDefined();
    });

    it('should include print settings and job link in stalled order reminder notification', async () => {
      await db.read();
      db.data.config.telegram = {
        enabled: true,
        stalledThresholdHours: 1,
        checkIntervalMinutes: 60,
        repeatReminderHours: 0,
      };
      const orderId = 'stalled-print-details-test';
      db.data.orders[orderId] = {
        orderId,
        status: 'ACCEPTED',
        receivedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
        billingContact: { givenName: 'Jane', familyName: 'Smith', email: 'jane@example.com' },
        orderDetails: {
          quantity: 100,
          size: '4.0" × 4.0"',
          resolution: 'dpi_1200',
          material: 'pp_clear',
        },
      };
      await db.write();

      bot.telegram.sendMessage.mockClear();
      bot.telegram.sendMessage.mockResolvedValueOnce({ message_id: 2222 });

      await checkStalledOrders({
        db,
        bot,
        getSecret: (k) => (k === 'BASE_URL' ? 'https://www.splotch.page' : process.env[k]),
        logger: console,
      });

      expect(bot.telegram.sendMessage).toHaveBeenCalled();
      const [channelId, message] = bot.telegram.sendMessage.mock.calls[0];
      expect(message).toContain('⚠️ Order Stalled: stalled-print-details-test');
      expect(message).toContain('📐 Size: 4.0" × 4.0"');
      expect(message).toContain('🖨 Resolution: 1200 DPI');
      expect(message).toContain('🏷 Material: Clear Polypropylene');
      expect(message).toContain('🔗 Job Link: https://www.splotch.page/printshop.html?orderId=stalled-print-details-test');
    });
  });

  describe('Pirate Ship Config & Order Label Endpoints', () => {
    it('should return autoSync status in GET /api/admin/integrations/pirateship', async () => {
      const res = await request(app)
        .get('/api/admin/integrations/pirateship')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.autoSync).toBe(true);
    });

    it('should toggle autoSync via POST /api/admin/integrations/pirateship/config', async () => {
      const res = await agent
        .post('/api/admin/integrations/pirateship/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ autoSync: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.autoSync).toBe(false);

      // Verify GET returns updated autoSync
      const getRes = await agent
        .get('/api/admin/integrations/pirateship')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(getRes.body.autoSync).toBe(false);
    });

    it('should update weight, dimensions and queue label via POST /api/orders/:orderId/order-label', async () => {
      const orderId = 'label-order-test-1';
      await db.read();
      db.data.orders[orderId] = {
        orderId,
        status: 'ACCEPTED',
        receivedAt: new Date().toISOString(),
        shippingContact: {
          givenName: 'Ship',
          familyName: 'Test',
          addressLines: ['456 Shipping Lane'],
          locality: 'Dallas',
          administrativeDistrictLevel1: 'TX',
          postalCode: '75001',
          country: 'US',
        },
      };
      await db.write();

      const res = await agent
        .post(`/api/orders/${orderId}/order-label`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({
          weightOz: 4.2,
          length: 8.5,
          width: 5.5,
          height: 1.0,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.labelRequested).toBe(true);
      expect(res.body.exportToPirateship).toBe(true);
      expect(res.body.packageWeightOz).toBe(4.2);
      expect(res.body.packageDimensions).toEqual({ length: 8.5, width: 5.5, height: 1.0 });

      // Verify stored in DB
      await db.read();
      const updated = db.data.orders[orderId];
      expect(updated.exportToPirateship).toBe(true);
      expect(updated.labelRequested).toBe(true);
      expect(updated.packageWeightOz).toBe(4.2);
      expect(updated.packageDimensions).toEqual({ length: 8.5, width: 5.5, height: 1.0 });
    });
  });
});
