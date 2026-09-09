/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { renderDevBanner, initSquareSandboxBanner } from '../src/dev-banner.js';

describe('Development Banner & Environment Detection', () => {
  describe('Server API (/api/config) Logic', () => {
    let app;

    beforeAll(() => {
      app = express();
      app.get('/api/config', (req, res) => {
        const nodeEnv = process.env.NODE_ENV || 'development';
        res.json({
          squareAppId: 'sandbox-test',
          squareLocationId: 'test-loc',
          squareEnvironment: 'sandbox',
          nodeEnv,
          isDevelopment: nodeEnv === 'development',
        });
      });
    });

    it('should return isDevelopment=true when NODE_ENV is development', async () => {
      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(200);
      expect(res.body.nodeEnv).toBe('development');
      expect(res.body.isDevelopment).toBe(true);
      process.env.NODE_ENV = oldEnv;
    });

    it('should return isDevelopment=false when NODE_ENV is production', async () => {
      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(200);
      expect(res.body.nodeEnv).toBe('production');
      expect(res.body.isDevelopment).toBe(false);
      process.env.NODE_ENV = oldEnv;
    });
  });

  describe('Client Dev Banner (DOM)', () => {
    beforeEach(() => {
      document.body.innerHTML = '<div class="top-menu-bar"></div>';
    });

    afterEach(() => {
      const banner = document.getElementById('dev-mode-banner');
      if (banner) banner.remove();
    });

    it('should not render banner if isDev is false', () => {
      renderDevBanner(false);
      expect(document.getElementById('dev-mode-banner')).toBeNull();
    });

    it('should render warning banner when isDev is true', () => {
      renderDevBanner(true);
      const banner = document.getElementById('dev-mode-banner');
      expect(banner).not.toBeNull();
      expect(banner.textContent).toContain('NODE_ENV="development" enabled');
      expect(banner.textContent).toContain('Real transactions are disabled');
    });

    it('should adjust top-menu-bar positioning when banner is rendered', () => {
      renderDevBanner(true);
      const topMenu = document.querySelector('.top-menu-bar');
      expect(topMenu.style.top).toBe('3.5rem');
    });

    it('should prevent duplicate banners when called multiple times', () => {
      renderDevBanner(true);
      renderDevBanner(true);
      const banners = document.querySelectorAll('#dev-mode-banner');
      expect(banners.length).toBe(1);
    });
  });

  describe('Square Sandbox Payment Banner & Highlight (DOM)', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="payment-details-section">
          <div id="square-sandbox-banner" class="hidden" style="display: none;">
            <span id="testCardNumberDisplay">4111 1111 1111 1111</span>
            <button id="copyTestCardBtn"><span id="copyTestCardText">Copy Card Number</span></button>
            <p>no real cards will be charged, and physical stickers will NOT be printed or shipped</p>
          </div>
          <div id="card-sandbox-hint" class="hidden" style="display: none;"></div>
          <div id="card-container"></div>
        </div>
      `;
    });

    it('should reveal sandbox banner and hint, and highlight payment section when isSandbox is true', () => {
      initSquareSandboxBanner(true);
      const banner = document.getElementById('square-sandbox-banner');
      const hint = document.getElementById('card-sandbox-hint');
      const section = document.getElementById('payment-details-section');

      expect(banner.classList.contains('hidden')).toBe(false);
      expect(banner.style.display).toBe('block');
      expect(hint.classList.contains('hidden')).toBe(false);
      expect(section.classList.contains('ring-amber-400')).toBe(true);
      expect(banner.textContent).toContain('4111 1111 1111 1111');
      expect(banner.textContent).toContain('physical stickers will NOT be printed or shipped');
    });

    it('should hide sandbox banner and remove highlights when isSandbox is false', () => {
      initSquareSandboxBanner(true);
      initSquareSandboxBanner(false);

      const banner = document.getElementById('square-sandbox-banner');
      const hint = document.getElementById('card-sandbox-hint');
      const section = document.getElementById('payment-details-section');

      expect(banner.classList.contains('hidden')).toBe(true);
      expect(banner.style.display).toBe('none');
      expect(hint.classList.contains('hidden')).toBe(true);
      expect(section.classList.contains('ring-amber-400')).toBe(false);
    });

    it('should copy test card number and update button text when copy button is clicked', async () => {
      const writeTextMock = jest.fn().mockResolvedValue();
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      initSquareSandboxBanner(true);
      const copyBtn = document.getElementById('copyTestCardBtn');
      const copyText = document.getElementById('copyTestCardText');

      copyBtn.click();
      await Promise.resolve();

      expect(writeTextMock).toHaveBeenCalledWith('4111 1111 1111 1111');
      expect(copyText.textContent).toBe('Copied!');
    });
  });
});
