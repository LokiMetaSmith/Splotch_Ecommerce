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
        severity: 'CRITICAL',
        ip: '198.51.100.99',
        method: 'GET',
        path: '/wp_login.php*test*',
        details: 'Automated vulnerability scanner',
        userAgent: 'curl/7.68.0 `malicious`',
      });

      expect(formatted).toContain('🚨 *SECURITY ALERT: [CRITICAL] Honeypot Triggered*');
      expect(formatted).toContain('`198.51.100.99`');
      expect(formatted).toContain('GET');
      expect(formatted).toContain('Automated vulnerability scanner');
      expect(formatted).not.toContain('`malicious`'); // backticks stripped/sanitized
    });
  });

  describe('Alert Dispatching, Severity Filtering and Cooldown Throttling', () => {
    beforeEach(() => {
      clearAlertCooldowns();
    });

    it('should immediately dispatch CRITICAL alert to telegram', async () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const mockSchedule = jest.fn().mockResolvedValue(true);

      const result = await dispatchSecurityAlert({
        type: 'Critical Secret Probe',
        severity: 'CRITICAL',
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
          severity: 'CRITICAL',
          type: 'Critical Secret Probe',
        })
      );

      // Verify fail2ban / crowdsec regex compliance in log
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[SECURITY\] Hostile attempt from IP 203\.0\.113\.50:.*Critical Secret Probe/)
      );

      warnSpy.mockRestore();
    });

    it('should skip telegram push for isolated LOW severity probe but still log for fail2ban', async () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const mockSchedule = jest.fn().mockResolvedValue(true);

      const result = await dispatchSecurityAlert({
        type: 'Scanner Probe',
        severity: 'LOW',
        ip: '203.0.113.60',
        method: 'GET',
        path: '/wp-login.php',
        scheduleTelegram: mockSchedule,
      });

      expect(result.alerted).toBe(false);
      expect(result.skippedSeverity).toBe(true);
      expect(mockSchedule).not.toHaveBeenCalled();

      // Logged for fail2ban / crowdsec despite no Telegram notification
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[SECURITY\] Hostile attempt from IP 203\.0\.113\.60:.*Scanner Probe/)
      );

      warnSpy.mockRestore();
    });

    it('should add details on repeated LOW strikes from the same IP but not escalate or alert', async () => {
      jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const mockSchedule = jest.fn().mockResolvedValue(true);

      // Strike 1: LOW severity, logged, no telegram alert
      const hit1 = await dispatchSecurityAlert({
        type: 'Scanner Probe',
        severity: 'LOW',
        ip: '203.0.113.70',
        path: '/wp-login.php',
        scheduleTelegram: mockSchedule,
      });
      expect(hit1.alerted).toBe(false);
      expect(mockSchedule).not.toHaveBeenCalled();

      // Strike 2: same IP hits again, details appended but not escalated -> NO Telegram alert
      const hit2 = await dispatchSecurityAlert({
        type: 'Scanner Probe',
        severity: 'LOW',
        ip: '203.0.113.70',
        path: '/xmlrpc.php',
        scheduleTelegram: mockSchedule,
      });
      expect(hit2.alerted).toBe(false);
      expect(hit2.severity).toBe('LOW');
      expect(mockSchedule).not.toHaveBeenCalled();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/Multi-strike repeat scanner \(Strike 2\)/)
      );

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

      // Set dedicated security channel
      process.env.TELEGRAM_SECURITY_CHANNEL_ID = 'dedicated-security-channel';
      process.env.TELEGRAM_CHANNEL_ID = 'orders-channel';

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

    it('should NOT trigger CRITICAL alert on /.env to dedicated security channel, just log as MEDIUM', async () => {
      jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const res = await request(app)
        .get('/.env')
        .set('X-Forwarded-For', '203.0.113.11');

      expect(res.statusCode).toBe(404);
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/\[SECURITY\] Hostile attempt from IP 203\.0\.113\.11: \[MEDIUM\] Critical Secret Probe/)
      );
      logger.warn.mockRestore();
    });

    it('should not notify Telegram on single isolated /wp-login.php scan (LOW severity)', async () => {
      const res = await request(app)
        .get('/wp-login.php')
        .set('X-Forwarded-For', '203.0.113.22');

      expect(res.statusCode).toBe(404);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('should NOT escalate and notify Telegram when same IP scans multiple times', async () => {
      jest.spyOn(logger, 'warn').mockImplementation(() => {});
      // Strike 1
      await request(app)
        .get('/wp-login.php')
        .set('X-Forwarded-For', '203.0.113.33');
      expect(mockSendMessage).not.toHaveBeenCalled();

      // Strike 2 (same IP)
      await request(app)
        .get('/xmlrpc.php')
        .set('X-Forwarded-For', '203.0.113.33');
      expect(mockSendMessage).not.toHaveBeenCalled();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/Multi-strike repeat scanner \(Strike 2\)/)
      );
      logger.warn.mockRestore();
    });

    it('should NOT trigger CRITICAL alert on /server/server.js sensitive path probe, just log as MEDIUM', async () => {
      jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const res = await request(app)
        .get('/server/server.js')
        .set('X-Forwarded-For', '203.0.113.44');

      expect(res.statusCode).toBe(403);
      expect(mockSendMessage).not.toHaveBeenCalled();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/\[SECURITY\] Hostile attempt from IP 203\.0\.113\.44: \[MEDIUM\] Sensitive Path Probe/)
      );
      logger.warn.mockRestore();
    });
  });
});
