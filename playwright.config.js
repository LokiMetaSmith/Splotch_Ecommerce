import { defineConfig } from '@playwright/test';

export default defineConfig({
  webServer: {
    command: 'node server/index.js',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Set a higher timeout for the server to start
    timeout: 120 * 1000,
    env: {
      SQUARE_ACCESS_TOKEN: 'dummy-token-for-testing',
      NODE_ENV: 'test',
    },
  },
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  testDir: 'playwright_tests',
  reporter: 'list',
});