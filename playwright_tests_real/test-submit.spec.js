import { test, expect } from '@playwright/test';

test('Debug form validation', async ({ page }) => {
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
                window.PLAYWRIGHT_TEST_MODE = true;
            `
        });
    });

    await page.goto('/');
    await page.waitForFunction(() => window.__appInitialized === true);

    await page.evaluate(() => {
        document.body.addEventListener('submit', (e) => {
            console.log('BODY SUBMIT LISTENER FIRED');
            e.preventDefault();
        });
    });

    const fileInput = page.locator('#file');
    await fileInput.setInputFiles('public/mascot.png');

    const priceDisplay = page.locator('#calculatedPriceDisplay');
    await expect(priceDisplay).toBeVisible({ timeout: 10000 });
    await expect(priceDisplay).not.toContainText('$0.00', { timeout: 10000 });

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
    console.log('Clicked submit button');

    await page.waitForTimeout(2000);
});
