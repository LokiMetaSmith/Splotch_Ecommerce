process.env.NODE_ENV = 'test';
process.env.TRUST_PROXY = 'true';

import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import logger from '../logger.js';
import {
  getClientIp,
  clearAlertCooldowns,
  formatSecurityAlertMessage,
  dispatchSecurityAlert,
} from '../lib/securityAlerts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security Monitoring & Intrusion Detection', () => {
  describe('IP Extraction & Normalization', () => {
    it('should extract client IP from cf-connecting-ip', () => {
      const req = {
        headers: { 'cf-connecting-ip': '203.0.113.195' },
      };
      expect(getClientIp(req)).toBe('203.0.113.195');
    });

    it('should extract first IP from comma-separated x-forwarded-for', () => {
      const req = {
        headers: { 'x-forwarded-for': '198.51.100.4, 10.0.0.1, 172.16.0.2' },
      };
      expect(getClientIp(req)).toBe('198.51.100.4');
    });

    it('should strip IPv6-mapped IPv4 prefix ::ffff:', () => {
      const req = {
        headers: {},
        socket: { remoteAddress: '::ffff:192.0.2.1' },
      };
      expect(getClientIp(req)).toBe('192.0.2.1');
    });

    it('should fallback to unknown if no IP available', () => {
      expect(getClientIp({})).toBe('unknown');
      expect(getClientIp(null)).toBe('unknown');
    });
  });

  describe('Telegram Alert Formatting & Sanitization', () => {
    it('should format clean Markdown and sanitize Markdown control characters', () => {
      const formatted = formatSecurityAlertMessage({
        type: 'Honeypot Triggered',
        ip: '198.51.100.99',
        method: 'GET',
        path: '/wp_login.php*test*',
        details: 'Automated vulnerability scanner',
        userAgent: 'curl/7.68.0 `malicious`',
      });

      expect(formatted).toContain('🚨 *SECURITY ALERT: Honeypot Triggered*');
      expect(formatted).toContain('`198.51.100.99`');
      expect(formatted).toContain('GET');
      expect(formatted).toContain('Automated vulnerability scanner');
      expect(formatted).not.toContain('`malicious`'); // backticks stripped/sanitized
    });
  });

  describe('Alert Dispatching and Cooldown Throttling', () => {
    beforeEach(() => {
      clearAlertCooldowns();
    });

    it('should log hostile attempt formatted for fail2ban and enqueue telegram alert', async () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const mockSchedule = jest.fn().mockResolvedValue(true);

      const result = await dispatchSecurityAlert({
        type: 'Scanner Honeypot Hit',
        ip: '203.0.113.50',
        method: 'GET',
        path: '/.env',
        details: 'Direct probe of environment secrets',
        userAgent: 'Go-http-client/1.1',
        scheduleTelegram: mockSchedule,
      });

      expect(result.alerted).toBe(true);
      expect(result.throttled).toBe(false);
      expect(mockSchedule).toHaveBeenCalledTimes(1);
      expect(mockSchedule).toHaveBeenCalledWith(
        'security-alert',
        expect.objectContaining({
          ip: '203.0.113.50',
          type: 'Scanner Honeypot Hit',
        })
      );

      // Verify fail2ban regex compliance in log
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[SECURITY\] Hostile attempt from IP 203\.0\.113\.50: Scanner Honeypot Hit/)
      );

      warnSpy.mockRestore();
    });

    it('should throttle repetitive alerts from the same IP within cooldown window', async () => {
      jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const mockSchedule = jest.fn().mockResolvedValue(true);

      // First alert: goes through
      const first = await dispatchSecurityAlert({
        type: 'Honeypot Triggered',
        ip: '198.51.100.77',
        path: '/wp-login.php',
        scheduleTelegram: mockSchedule,
      });
      expect(first.alerted).toBe(true);

      // Second alert immediately after: throttled
      const second = await dispatchSecurityAlert({
        type: 'Honeypot Triggered',
        ip: '198.51.100.77',
        path: '/xmlrpc.php',
        scheduleTelegram: mockSchedule,
      });
      expect(second.alerted).toBe(false);
      expect(second.throttled).toBe(true);
      expect(second.reason).toBe('ip_cooldown');

      // But a different IP can still alert
      const differentIp = await dispatchSecurityAlert({
        type: 'Honeypot Triggered',
        ip: '198.51.100.88',
        path: '/.git/config',
        scheduleTelegram: mockSchedule,
      });
      expect(differentIp.alerted).toBe(true);
      expect(mockSchedule).toHaveBeenCalledTimes(2);

      logger.warn.mockRestore();
    });
  });

  describe('Server Endpoints & Live Traps', () => {
    let app;
    let db;
    let bot;
    let server;
    let mockSendMessage;
    const testDbPath = path.join(__dirname, 'security-test-db.json');

    beforeAll(async () => {
      clearAlertCooldowns();

      const data = { orders: [], users: {}, credentials: {}, config: {}, emailIndex: {} };
      db = {
        data,
        write: async () => {},
        read: async () => {},
      };

      mockSendMessage = jest.fn().mockResolvedValue({ message_id: 101 });
      bot = {
        telegram: {
          sendMessage: mockSendMessage,
        },
        stop: jest.fn(),
      };

      process.env.TELEGRAM_CHANNEL_ID = 'test-security-channel';
      const { startServer } = await import('../server.js');
      server = await startServer(db, bot, jest.fn(), testDbPath);
      app = server.app;
    });

    afterAll(async () => {
      if (server && typeof server.close === 'function') {
        await server.close();
      }
      try {
        await fs.unlink(testDbPath);
      } catch (e) {}
    });

    beforeEach(() => {
      clearAlertCooldowns();
      mockSendMessage.mockClear();
    });

    it('should trigger honeypot trap on /.env and return 404', async () => {
      const res = await request(app)
        .get('/.env')
        .set('X-Forwarded-For', '203.0.113.11');

      expect(res.statusCode).toBe(404);
      expect(mockSendMessage).toHaveBeenCalledWith(
        'test-security-channel',
        expect.stringContaining('Honeypot Trap Triggered'),
        { parse_mode: 'Markdown' }
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        'test-security-channel',
        expect.stringContaining('203.0.113.11'),
        { parse_mode: 'Markdown' }
      );
    });

    it('should trigger honeypot trap on /wp-login.php and return 404', async () => {
      const res = await request(app)
        .get('/wp-login.php')
        .set('X-Forwarded-For', '203.0.113.22');

      expect(res.statusCode).toBe(404);
      expect(mockSendMessage).toHaveBeenCalledWith(
        'test-security-channel',
        expect.stringContaining('/wp-login.php'),
        { parse_mode: 'Markdown' }
      );
    });

    it('should trigger honeypot trap on /actuator/env and return 404', async () => {
      const res = await request(app)
        .get('/actuator/env')
        .set('X-Forwarded-For', '203.0.113.33');

      expect(res.statusCode).toBe(404);
      expect(mockSendMessage).toHaveBeenCalledWith(
        'test-security-channel',
        expect.stringContaining('/actuator/env'),
        { parse_mode: 'Markdown' }
      );
    });

    it('should trigger sensitive path blocker on /server/server.js and return 403', async () => {
      const res = await request(app)
        .get('/server/server.js')
        .set('X-Forwarded-For', '203.0.113.44');

      expect(res.statusCode).toBe(403);
      expect(mockSendMessage).toHaveBeenCalledWith(
        'test-security-channel',
        expect.stringContaining('Sensitive Path Probe'),
        { parse_mode: 'Markdown' }
      );
    });
  });
});
