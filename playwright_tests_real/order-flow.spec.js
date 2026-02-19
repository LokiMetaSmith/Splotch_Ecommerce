import { test, expect } from '@playwright/test';

test.describe('Real Backend Order Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Mock Square SDK
        // We need to ensure this runs before the page loads the real Square script if possible,
        // or overrides it. Since the real script is async/defer, addInitScript should work.
        // However, if the real script loads faster, it might overwrite our mock.
        // To be safe, we can also route the Square script to return our mock code or nothing.

        await page.route('**/*square.js*', route => {
             return route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                body: `
                    window.Square = {
                        payments: () => ({
                            card: async () => ({
                                attach: async () => { console.log('Mock Card Attached'); },
                                tokenize: async () => ({ status: 'OK', token: 'mock-sq-token-client' }),
                                destroy: async () => {},
                            })
                        })
                    };
                `
            });
        });
    });

    test('should upload image, verify price, and create order', async ({ page }) => {
        test.setTimeout(60000);
        // 1. Navigate to home
        await page.goto('/');

        // 2. Upload image
        // Wait for input to be ready? It's usually ready.
        const fileInput = page.locator('#file');
        await fileInput.setInputFiles('public/mascot.png');

        // 3. Wait for upload/processing
        // Wait for price to be visible and not $0.00
        const priceDisplay = page.locator('#calculatedPriceDisplay');
        await expect(priceDisplay).toBeVisible({ timeout: 10000 });
        // The default might be $0.00 initially, then updates.
        // We expect it to change.
        await expect(priceDisplay).not.toContainText('$0.00', { timeout: 10000 });

        // 4. Fill checkout form
        await page.locator('#firstName').fill('Test');
        await page.locator('#lastName').fill('User');
        await page.locator('#email').fill('test@example.com');
        // Phone is optional but good to fill
        await page.locator('#phone').fill('555-0123');

        await page.locator('#address').fill('123 Test St');
        await page.locator('#city').fill('Test City');
        await page.locator('#state').fill('TS');
        await page.locator('#postalCode').fill('12345');

        // 5. Submit
        // Ensure button is enabled
        const submitBtn = page.locator('#submitPaymentBtn');
        await expect(submitBtn).toBeEnabled();
        await submitBtn.click();

        // 6. Verify success
        const statusContainer = page.locator('#payment-status-container');
        await expect(statusContainer).toBeVisible({ timeout: 30000 }); // Processing might take time (uploads, etc)
        await expect(statusContainer).toContainText('Order successfully placed!', { timeout: 30000 });

        // 7. Verify redirect
        await expect(page).toHaveURL(/orders\.html\?token=/, { timeout: 10000 });

        // 8. Verify order in history via Real Login (since Guest token cannot view history)
        // Request Magic Link
        await page.goto('/orders.html'); // Clear params
        await page.locator('#emailInput').fill('test@example.com');
        await page.locator('#loginBtn').click();
        await expect(page.locator('#login-status')).toContainText('Magic link sent');

        // Fetch token from test endpoint
        const response = await page.request.get(`/api/test/last-magic-link?email=${encodeURIComponent('test@example.com')}`);
        expect(response.ok()).toBeTruthy();
        const { token } = await response.json();

        // Login with real token
        await page.goto(`/orders.html?token=${token}`);

        // Verify order is visible
        await expect(page.locator('#orders-list')).toBeVisible({ timeout: 10000 });
        // The order card should be present now
        await expect(page.locator('.order-card').first()).toBeVisible({ timeout: 10000 });
    });
});
