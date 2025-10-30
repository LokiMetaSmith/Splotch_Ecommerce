import { defineConfig } from '@playwright/test';

export default defineConfig({
  webServer: {
    // FIX: Use the Vite dev server for frontend tests, not the Node backend.
    command: 'npm run dev',
    url: 'http://localhost:5173', // Vite's default port
    reuseExistingServer: !process.env.CI, // Reuse server in local dev for speed
    // Set a higher timeout for the server to start
    timeout: 120 * 1000,
    env: {
      SQUARE_ACCESS_TOKEN: 'dummy-token-for-testing',
      NODE_ENV: 'test',
    },
  },
  use: {
    baseURL: 'http://localhost:5173', // Match the webServer port
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  testDir: 'playwright_tests',
  reporter: 'list',
});
