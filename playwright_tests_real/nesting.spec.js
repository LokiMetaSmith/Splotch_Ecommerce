import { test, expect } from '@playwright/test';

test.describe('Nesting Functionality', () => {
    test('should place an order, log into printshop, accept the order, nest, and view the resulting svg', async ({ page, request }) => {
        test.setTimeout(120000); 

        page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
        page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
        
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

        // 1. Navigate to home and place order
        await page.goto('/');

        // Wait for BootStrap to complete async initialization
        await page.waitForFunction(() => window.__appInitialized === true);
        
        const fileInput = page.locator('#file');
        await fileInput.setInputFiles('public/mascot.png');
        
        // Wait for upload/processing
        const priceDisplay = page.locator('#calculatedPriceDisplay');
        await expect(priceDisplay).toBeVisible({ timeout: 10000 });
        await expect(priceDisplay).not.toContainText('$0.00', { timeout: 10000 });
        
        // Wait for Dimensions to populate so we know originalImage is processed
        const widthInput = page.locator('#widthInput');
        await expect(widthInput).not.toHaveValue('', { timeout: 15000 });

        await page.locator('#firstName').fill('Test');
        await page.locator('#lastName').fill('User');
        await page.locator('#email').fill('customer@example.com');
        await page.locator('#phone').fill('555-0123');

        await page.locator('#address').fill('123 Test St');
        await page.locator('#city').fill('Test City');
        await page.locator('#state').fill('TS');
        await page.locator('#postalCode').fill('12345');
        // Let's change quantity to 5 for nesting
        await page.locator('#stickerQuantity').fill('5');

        await page.locator('#submitPaymentBtn').click();
        
        const statusContainer = page.locator('#payment-status-container');
        await expect(statusContainer).toBeVisible({ timeout: 30000 });
        await expect(statusContainer).toContainText('Order successfully placed!', { timeout: 30000 });

        // 2. Log into printshop
        const tokenRes = await request.post('/api/auth/issue-temp-token', {
            data: { secret: process.env.TEMP_AUTH_SECRET || 'dev-secret-key', email: 'admin@splotch.com' }
        });
        const tokenData = await tokenRes.json();
        const token = tokenData.token;

        await page.context().addCookies([{
            name: 'sessionToken',
            value: token,
            domain: '127.0.0.1',
            path: '/',
            httpOnly: false
        }]);

        await page.goto('/printshop.html');
        
        // Wait for order to appear
        const orderCards = page.locator('.order-card');
        await expect(orderCards.first()).toBeVisible({ timeout: 10000 });

        // Find the order by email
        const orderToFulfill = orderCards.filter({ hasText: 'customer@example.com' }).first();
        await expect(orderToFulfill).toBeVisible();

        // Check the checkbox to select for nesting
        const checkbox = orderToFulfill.locator('.order-select-checkbox');
        await checkbox.check();

        // Click Nest Stickers
        const nestBtn = page.locator('#nestStickersBtn');
        await nestBtn.click();

        // Wait for nested SVG container to have an SVG
        const nestedSvg = page.locator('#nested-svg-container svg').first();
        await expect(nestedSvg).toBeVisible({ timeout: 45000 });
        
        // Assert cutlines are present by checking if there's an element with class .cut-line-element
        const cutlines = page.locator('#nested-svg-container .cut-line-element').first();
        await expect(cutlines).toBeAttached({ timeout: 5000 });

        console.log("Nesting complete and cutlines verified!");
    });
});
