
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.describe('Bolt Optimization Verification', () => {
    test.beforeEach(async ({ page }) => {
        // Mock API responses
        await page.route('**/api/server-info', async route => {
            await route.fulfill({ json: { serverSessionToken: 'mock-token' } });
        });

        await page.route('**/api/csrf-token', async route => {
            await route.fulfill({ json: { csrfToken: 'mock-csrf' } });
        });

        await page.route('**/api/auth/verify-token', async route => {
             // Simulate logged in user
             await route.fulfill({ json: { username: 'bolt', email: 'bolt@example.com' } });
        });

        await page.route('**/api/orders', async route => {
            await route.fulfill({
                json: [
                    {
                        orderId: 'order-1',
                        status: 'NEW',
                        receivedAt: new Date().toISOString(),
                        amount: 1000,
                        billingContact: { givenName: 'Test', familyName: 'User', email: 'test@example.com' },
                        shippingContact: { givenName: 'Test', familyName: 'User', email: 'test@example.com' },
                        orderDetails: { quantity: 10 },
                        designImagePath: '/placeholder.png'
                    },
                    {
                        orderId: 'order-2',
                        status: 'NEW',
                        receivedAt: new Date().toISOString(),
                        amount: 2000,
                        billingContact: { givenName: 'Test', familyName: 'User 2', email: 'test2@example.com' },
                        shippingContact: { givenName: 'Test', familyName: 'User 2', email: 'test2@example.com' },
                        orderDetails: { quantity: 20 },
                        designImagePath: '/placeholder.png'
                    }
                ]
            });
        });

        // Mock image requests to avoid errors
        await page.route('**/*.png', route => route.fulfill({ body: Buffer.from('') }));
    });

    test('should display orders correctly with DocumentFragment optimization', async ({ page }) => {
        // We need to inject a mock token into localStorage to trigger the "logged in" state logic
        await page.addInitScript(() => {
            localStorage.setItem('authToken', 'mock-jwt-token');
        });

        await page.goto('http://localhost:5173/printshop.html');

        // Wait for orders to load
        await expect(page.locator('.order-card')).toHaveCount(2);

        // Verify order: Server sends [Order 1, Order 2].
        // Logic: Iterate [Order 1, Order 2].
        // 1. Fragment Prepend Order 1 -> [Order 1]
        // 2. Fragment Prepend Order 2 -> [Order 2, Order 1]
        // DOM Append Fragment -> [Order 2, Order 1]
        // So Order 2 (Newer/Last in list) should be first in DOM?

        // Wait, server returns `allOrders.slice().reverse()`.
        // If DB has Order 1, Order 2 (Order 2 is newer).
        // Server returns [Order 2, Order 1].
        // Frontend logic:
        // Iterate [Order 2, Order 1].
        // 1. Prepend Order 2 -> [Order 2]
        // 2. Prepend Order 1 -> [Order 1, Order 2]
        // DOM Append -> [Order 1, Order 2].

        // So Order 1 (Oldest) is at top. This matches the legacy behavior I analyzed.

        const firstCardId = await page.locator('.order-card').first().getAttribute('id');
        // Expect Order 1 to be first?
        // Let's see what happens.

        await page.screenshot({ path: 'verification/optimization_check.png', fullPage: true });
    });
});
