import { test as base } from '@playwright/test';
import { expect } from '@playwright/test';

// Extend the base test to include automatic API mocking.
export const test = base.extend({
  // 'auto' automatically runs this fixture for every test that uses it.
  autoMock: [async ({ page }, use) => {
    // Set up the mock before the test runs
    await page.route('**/api/**', (route) => {
      const url = route.request().url();
      console.log(`[MOCK] Intercepted and mocked API request: ${url}`);

      // Provide a generic successful response
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'This is a mocked API response!' }),
      });
    });

    // Run the actual test
    await use();
  }, { auto: true }],
});

// Re-export expect so you can import both from this file
export { expect };
