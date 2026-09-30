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
        // the calculatedPriceDisplay might be hidden on mobile, wait for widthInput instead
        
        // Ensure we switch to tab 1 (art) to see widthInput if hidden on mobile
        const artTab = page.locator('.mobile-tab-btn[data-tab="art"]');
        if (await artTab.isVisible()) {
          await artTab.click({ force: true });
        }

        // Wait for Dimensions to populate so we know originalImage is processed
        const widthInput = page.locator('#widthInput');
        await expect(widthInput).not.toHaveValue('', { timeout: 15000 });

        // Switch to Specs/Checkout tab on mobile if tabs are present
        const specsTab = page.locator('.mobile-tab-btn[data-tab="specs"]');
        if (await specsTab.isVisible()) {
          // Force click to ensure it switches
          await specsTab.click({ force: true });
          await expect(page.locator('#firstName')).toBeVisible({ timeout: 10000 });
        }

        await page.locator('#firstName').fill('Test');
        await page.locator('#lastName').fill('User');
        await page.locator('#email').fill('customer@example.com');
        await page.locator('#phone').fill('555-0123');

        // Switch to Cutlines tab on mobile if tabs are present to fill quantity
        const cutlinesTab = page.locator('.mobile-tab-btn[data-tab="cutlines"]');
        if (await cutlinesTab.isVisible()) {
          await cutlinesTab.click({ force: true });
        }

        // Let's change quantity to 5 for nesting
        await page.locator('#stickerQuantity').fill('5');
        await page.keyboard.press('Tab'); // Trigger price calculation
        await page.waitForTimeout(2500);

        // Switch back to Specs tab to continue checkout form
        if (await specsTab.isVisible()) {
          await specsTab.click({ force: true });
        }

        await page.locator('#address').fill('123 Test St');
        await page.locator('#city').fill('Test City');
        await page.locator('#state').fill('TS');
        await page.locator('#postalCode').fill('12345');

        await page.locator('#order-ready-confirm').check();
        await page.locator('#submitPaymentBtn').click();
        
        // Mobile Safari gets redirected to order history on success before it can see the success message sometimes, so we check URL as an alternative success criteria
        await page.waitForTimeout(5000);

        try {
          const statusContainer = page.locator('#payment-status-container');
          await expect(statusContainer).toBeVisible({ timeout: 15000 });
          await expect(statusContainer).toContainText('Order successfully placed!', { timeout: 15000 });
        } catch (e) {
          // If we timeout checking the message, check if we got redirected to orders.html which also means success
          await expect(page).toHaveURL(/.*orders.html/);
        }

        // 2. Log into printshop
        const tokenRes = await request.get('/api/auth/test-admin-token');
        expect(tokenRes.ok()).toBeTruthy();

        const tokenData = await tokenRes.json();
        const token = tokenData.token;
        expect(token).toBeTruthy();

        // Add init script before navigation to populate localStorage on load
        await page.addInitScript((t) => {
          localStorage.setItem('authToken', t);
          localStorage.setItem('sessionToken', t);
          localStorage.setItem('serverSessionToken', t);
        }, token);

        await page.goto('/printshop.html');
        
        // Wait for order to appear
        const orderCards = page.locator('.order-card');
        await expect(orderCards.first()).toBeVisible({ timeout: 15000 });

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
