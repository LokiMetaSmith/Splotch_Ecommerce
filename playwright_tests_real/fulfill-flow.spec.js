import { test, expect } from '@playwright/test';

test.describe('Order and Fulfillment Flow', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/*square.js*', route => {
             return route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                body: `
                    window.Square = {
                        payments: () => ({
                            card: async () => ({
                                attach: async () => { console.log('Mock Card Attached'); },
                                tokenize: async () => ({ status: 'OK', token: 'cnon:card-nonce-ok' }),
                                destroy: async () => {},
                            })
                        })
                    };
                `
            });
        });
    });

    test('should place an order, log into printshop, and fulfill it', async ({ page, context }) => {
        test.setTimeout(120000); // 2 minutes, as we are doing a full end-to-end

        page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
        page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
        page.on('request', req => {
            if (req.url().includes('/api/auth/issue-temp-token')) {
                console.log('--- ISSUE-TEMP-TOKEN REQUEST ---');
                console.log('Headers:', req.headers());
            }
        });
        page.on('response', async res => {
            if (res.url().includes('/api/csrf-token')) {
                console.log('--- CSRF-TOKEN RESPONSE ---');
                console.log('Headers:', res.headers());
            }
        });
        
        // 1. Navigate to home and place order
        await page.goto('/');

        // Wait for BootStrap to complete async initialization
        await page.waitForFunction(() => window.__appInitialized === true);
        
        const fileInput = page.locator('#file');
        await fileInput.setInputFiles('public/mascot.png');
        
        // 3. Wait for upload/processing
        const priceDisplay = page.locator('#calculatedPriceDisplay');
        await expect(priceDisplay).toBeVisible({ timeout: 10000 });
        await expect(priceDisplay).not.toContainText('$0.00', { timeout: 10000 });
        
        // Wait for Dimensions to populate so we know originalImage is processed
        const widthDisplay = page.locator('#widthDisplay');
        await expect(widthDisplay).not.toContainText('---', { timeout: 15000 });

        await page.locator('#firstName').fill('Test');
        await page.locator('#lastName').fill('User');
        await page.locator('#email').fill('customer@example.com');
        await page.locator('#phone').fill('555-0123');

        await page.locator('#address').fill('123 Test St');
        await page.locator('#city').fill('Test City');
        await page.locator('#state').fill('TS');
        await page.locator('#postalCode').fill('12345');

        const submitBtn = page.locator('#submitPaymentBtn');
        await expect(submitBtn).toBeEnabled();
        await submitBtn.click();

        const statusContainer = page.locator('#payment-status-container');
        await expect(statusContainer).toBeVisible({ timeout: 30000 });
        await expect(statusContainer).toContainText('Order successfully placed!', { timeout: 30000 });
        await expect(page).toHaveURL(/.*\/orders\.html\?requires_login=true$/, { timeout: 10000 });

        // Request Magic Link for admin by using the UI on orders.html
        await page.goto('/orders.html');
        await page.locator('#emailInput').fill('admin@example.com');
        await page.click('#loginBtn');
        
        // Wait for the success message to ensure the request finished
        await expect(page.locator('#login-status')).toContainText('Magic link sent!', { timeout: 10000 });

        // Fetch token from test endpoint
        const response = await page.request.get(`http://127.0.0.1:3000/api/test/last-magic-link?email=${encodeURIComponent('admin@example.com')}`);
        expect(response.ok()).toBeTruthy();
        const { token } = await response.json();

        // Login via magic link processor by exchanging it in the browser context
        await page.evaluate(async (magicToken) => {
            const csrfResponse = await fetch('/api/csrf-token');
            const { csrfToken } = await csrfResponse.json();
            
            const verifyResponse = await fetch('/api/auth/verify-magic-link', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({ token: magicToken })
            });
            const { token: authToken } = await verifyResponse.json();
            localStorage.setItem('authToken', authToken);
        }, token);
        
        // Navigate to printshop
        await page.goto('/printshop.html');

        // 3. Fulfill the order
        // Find our order in the list. Wait for the order list to be populated.
        const orderCards = page.locator('.order-card');
        await expect(orderCards.first()).toBeVisible({ timeout: 10000 });

        // Since it's the latest order, it should be the first one, or we can look for it by customer email
        const orderToFulfill = orderCards.filter({ hasText: 'customer@example.com' }).first();
        await expect(orderToFulfill).toBeVisible();

        // Mark as PRINTING
        const actionDropdown = orderToFulfill.locator('select.action-dropdown');
        await actionDropdown.selectOption('PRINTING');
        
        const successToast = page.locator('#success-toast');
        await expect(successToast).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#success-message')).toContainText('Order status updated');
        
        // Wait for the toast to go away or force close it to prevent blocking
        await page.waitForTimeout(1000);

        // Mark as COMPLETED
        await actionDropdown.selectOption('COMPLETED');
        
        // Since we changed the select, wait for toast
        await expect(page.locator('#success-toast')).toBeVisible({ timeout: 10000 });
        await expect(orderToFulfill).toContainText('COMPLETED', { timeout: 10000 });
    });
});
