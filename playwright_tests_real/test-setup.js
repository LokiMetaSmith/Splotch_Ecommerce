import { test as base } from '@playwright/test';
import { expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Load actual content of server/pricing.json to avoid mock drift
const pricingConfig = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'server', 'pricing.json'), 'utf8')
);


// Extend the base test to include automatic API mocking.
export const test = base.extend({
  // 'auto' automatically runs this fixture for every test that uses it.
  autoMock: [async ({ page }, use) => {
    // Mock the Square Web Payments SDK
    await page.addInitScript(() => {
      window.Square = {
        payments: () => ({
          card: async () => ({
            attach: async () => {},
            tokenize: async () => ({ status: 'OK', token: 'mock-sq-token' }),
            destroy: async () => {},
          })
        })
      };
    });

    // Intercept requests
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        const pathname = url.pathname;

        // Block external Square SDK to prevent it from overwriting our mock
        if (url.hostname.includes('squarecdn') || pathname.endsWith('square.js')) {
            console.log(`[MOCK] Blocking external script: ${url.href}`);
            return route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                body: 'console.log("Square SDK blocked by test");'
            });
        }

        // Handle API requests
        if (pathname.startsWith('/api/') || pathname.includes('/api/')) {
            console.log(`[MOCK] Intercepted API request for: ${pathname}`);

            if (pathname.endsWith('/api/csrf-token')) {
                return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ csrfToken: 'mock-csrf-token-12345' }),
                });
            }

            if (pathname.includes('/api/test/last-magic-link')) {
                return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, token: "mock-auth-token-12345" }),
                });
            }

            if (pathname.endsWith('/api/auth/user/data')) {
                return route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ success: false, message: "User not found" }),
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

            if (pathname.endsWith('/api/auth/verify-magic-link')) {
                return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, token: "mock-auth-token-12345" }),
                });
            }

            if (pathname.endsWith('/api/auth/verify-magic-link')) {
                return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, token: "mock-auth-token-12345" }),
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

            if (pathname.endsWith('/api/convert-image')) {
                return route.fulfill({
                status: 200,
                contentType: 'image/png',
                body: Buffer.from(
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
                    'base64'
                )
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

            if (pathname.endsWith('/api/order/estimate')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        subtotalCents: 1000,
                        shippingCents: 0,
                        taxCents: 0,
                        grandTotalCents: 1000
                    })
                });
            }

            if (pathname.endsWith('/api/config')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ squareAppId: 'sandbox-mock-id', squareLocationId: 'mock-location-id', enableStripe: false })
                });
            }

            if (pathname.endsWith('/api/server-info')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ version: '1.0.0-mock', environment: 'test' })
                });
            }

            if (pathname.endsWith('/api/auth/verify-token')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ username: 'testuser', email: 'test@example.com' })
                });
            }

            if (pathname.endsWith('/api/auth/test-admin-token')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ token: 'mock-admin-token-123' })
                });
            }

            if (pathname.endsWith('/api/inventory')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({})
                });
            }

            // Default handlers for other endpoints
            if (pathname.includes('/api/orders')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ orders: [{
                        orderId: 'mock-order-id-67890',
                        friendlyName: 'Mock-Order',
                        status: 'RECEIVED',
                        email: 'customer@example.com',
                        grandTotalCents: 1000,
                        deliveryMethod: 'shipping',
                        firstName: 'Test',
                        lastName: 'User',
                        address: '123 Test St',
                        city: 'Test City',
                        state: 'TS',
                        postalCode: '12345',
                        items: [{
                            designImagePath: '/uploads/mocked-design.png',
                            cutLinePath: null,
                            widthInches: 2,
                            heightInches: 2,
                            quantity: 5,
                            cutShape: 'trace',
                            materialId: 'pvc_laminated',
                            resolutionId: 'dpi_300',
                            isGrayscale: false,
                            isSepia: false
                        }]
                    }] })
                });
            }

            if (pathname.includes('/api/admin/printshops') || pathname.includes('/api/admin/sales-metrics')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ })
                });
            }

            // Fallback for unhandled API routes
            console.warn(`[MOCK] Unhandled API route: ${pathname}`);
            return route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ error: `Mock not found for ${pathname}` }),
            });
        }

        // If not an API request, let the mock router try to fulfill missing files if needed, or just continue
        return route.continue();
    });

    // Run the actual test
    await use(page);
  }, { auto: true }],
});

// Re-export expect so you can import both from this file
export { expect };
