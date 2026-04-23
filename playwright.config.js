import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  webServer: {
    command: 'npm run dev',
    url: 'https://localhost:5173', // Vite's default port
    reuseExistingServer: !process.env.CI, // Reuse server in local dev for speed
    // Set a higher timeout for the server to start
    timeout: 120 * 1000,
    env: {
      SQUARE_ACCESS_TOKEN: 'dummy-token-for-testing',
      NODE_ENV: 'test',
    },
    ignoreHTTPSErrors: true,
  },
  use: {
    baseURL: 'https://localhost:5173', // Match the webServer port
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  testDir: 'playwright_tests',
  reporter: 'list',
});
