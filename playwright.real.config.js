import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config.js';

export default defineConfig({
  ...baseConfig,
  webServer: [
    {
      command: 'npm run dev',
      port: 5173,
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node server/index.js',
      port: 3000,
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'test',
        PORT: '3000',
        SQUARE_ACCESS_TOKEN: 'dummy-token-for-testing', // We still need this to pass server start checks
        SESSION_SECRET: 'test-session-secret-1234567890',
      },
    },
  ],
  testDir: 'playwright_tests_real',
  // Ensure we don't accidentally run this if we run `playwright test` without args if we set it as default config.
  // But usually `playwright test` picks up `playwright.config.js`.
  // We will run this via `playwright test --config playwright.real.config.js`
});
