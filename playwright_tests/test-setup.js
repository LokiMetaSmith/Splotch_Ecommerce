import { test as base } from '@playwright/test';
import { expect } from '@playwright/test';

// This is the actual content of server/pricing.json
const pricingConfig = {
  "pricePerSquareInchCents": 15,
  "resolutions": [
    { "id": "dpi_96", "name": "96 DPI (Draft)", "ppi": 96, "costMultiplier": 1.0 },
    { "id": "dpi_300", "name": "300 DPI (Standard)", "ppi": 300, "costMultiplier": 1.3 },
    { "id": "dpi_600", "name": "600 DPI (High Quality)", "ppi": 600, "costMultiplier": 1.5 },
    { "id": "dpi_1200", "name": "1200 DPI (Archival)", "ppi": 1200, "costMultiplier": 1.8 }
  ],
  "materials": [
    { "id": "pp_standard", "name": "Standard Polypropylene", "costMultiplier": 1.0 },
    { "id": "pvc_laminated", "name": "Laminated PVC", "costMultiplier": 1.5 }
  ],
  "complexity": {
    "description": "Multiplier based on the perimeter of the cut path.",
    "tiers": [
      { "thresholdInches": 12, "multiplier": 1.0 },
      { "thresholdInches": 24, "multiplier": 1.1 },
      { "thresholdInches": "Infinity", "multiplier": 1.25 }
    ]
  },
  "quantityDiscounts": [
    { "quantity": 1, "discount": 0.0 },
    { "quantity": 200, "discount": 0.10 },
    { "quantity": 500, "discount": 0.15 }
  ]
};


// Extend the base test to include automatic API mocking.
export const test = base.extend({
  // 'auto' automatically runs this fixture for every test that uses it.
  autoMock: [async ({ page }, use) => {
    // Set up the mock before the test runs
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      const pathname = url.pathname;
      console.log(`[MOCK] Intercepted API request for: ${pathname}`);

      // --- API Mock Router ---

      if (pathname.endsWith('/api/csrf-token')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ csrfToken: 'mock-csrf-token-12345' }),
        });
      }

      if (pathname.endsWith('/api/pricing-info')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(pricingConfig),
        });
      }

      if (pathname.endsWith('/api/auth/magic-login')) {
         return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, message: "Magic link sent!" }),
        });
      }

      if (pathname.endsWith('/api/upload-design')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Upload successful',
            designImagePath: '/uploads/mocked-design.png',
            cutLinePath: null
          }),
        });
      }

      if (pathname.endsWith('/api/auth/issue-temp-token')) {
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ token: 'mock-temp-auth-token-xyz' })
        });
      }

      if (pathname.endsWith('/api/create-order')) {
          return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ success: true, orderId: 'mock-order-id-67890' })
          });
      }

      if (pathname.endsWith('/api/server-info')) {
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ version: '1.0.0-mock', environment: 'test' })
        });
      }


      // --- Fallback for unhandled routes ---
      console.warn(`[MOCK] Unhandled API route: ${pathname}`);
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: `Mock not found for ${pathname}` }),
      });
    });

    // Run the actual test
    await use();
  }, { auto: true }],
});

// Re-export expect so you can import both from this file
export { expect };
