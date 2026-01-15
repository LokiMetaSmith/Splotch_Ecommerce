
const { test, expect } = require('@playwright/test');

test.describe('Nesting Functionality', () => {
    test.beforeEach(async ({ page }) => {
        // Mock API responses
        await page.route('**/api/server-info', async route => {
            await route.fulfill({ json: { serverSessionToken: 'mock-token' } });
        });

        await page.route('**/api/csrf-token', async route => {
            await route.fulfill({ json: { csrfToken: 'mock-csrf' } });
        });

        await page.route('**/api/auth/verify-token', async route => {
             await route.fulfill({ json: { username: 'admin', email: 'admin@example.com' } });
        });

        // Mock orders with a simple SVG image
        await page.route('**/api/orders', async route => {
            await route.fulfill({
                json: [
                    {
                        orderId: 'order-nest-1',
                        status: 'NEW',
                        receivedAt: new Date().toISOString(),
                        amount: 1000,
                        billingContact: { givenName: 'Test', familyName: 'User', email: 'test@example.com' },
                        shippingContact: { givenName: 'Test', familyName: 'User', email: 'test@example.com' },
                        orderDetails: { quantity: 1 },
                        designImagePath: '/test-sticker.svg',
                        cutLinePath: '/test-cutline.svg'
                    }
                ]
            });
        });

        // Mock the SVG file requests
        const simpleSvg = '<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="50" height="50" fill="red"/></svg>';
        await page.route('**/test-sticker.svg', route => route.fulfill({ body: simpleSvg, contentType: 'image/svg+xml' }));
        await page.route('**/test-cutline.svg', route => route.fulfill({ body: simpleSvg, contentType: 'image/svg+xml' }));
    });

    test('should generate nested layout when "Nest Stickers" is clicked', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('authToken', 'mock-jwt-token');
        });

        await page.goto('http://localhost:5173/printshop.html');

        // Wait for orders to load
        await expect(page.locator('#order-card-order-nest-1')).toBeVisible();

        // Click Nest Stickers button
        await page.click('#nestStickersBtn');

        // Check for loading state (optional, might happen too fast)
        // await expect(page.locator('#loading-indicator')).toBeVisible();

        // Wait for the nested SVG to appear in the container
        // The implementation updates innerHTML of #nested-svg-container
        // We expect an <svg> element inside it.
        await expect(page.locator('#nested-svg-container svg')).toBeVisible({ timeout: 10000 });

        // Verify the SVG has valid dimensions (basic sanity check)
        const svg = page.locator('#nested-svg-container svg');
        await expect(svg).toHaveAttribute('width');
        await expect(svg).toHaveAttribute('height');

        // Check for Success Toast
        await expect(page.locator('#success-toast')).toBeVisible();
        await expect(page.locator('#success-message')).toContainText('Nesting complete');
    });
});
