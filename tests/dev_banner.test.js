/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { renderDevBanner } from '../src/dev-banner.js';

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
});
