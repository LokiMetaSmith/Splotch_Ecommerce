const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

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

    await page.goto('http://127.0.0.1:3000/');
    await page.waitForFunction(() => window.__appInitialized === true);

    const fileInput = page.locator('#file');
    await fileInput.setInputFiles('public/mascot.png');

    const priceDisplay = page.locator('#calculatedPriceDisplay');
    await priceDisplay.waitFor({ state: 'visible', timeout: 10000 });
    await priceDisplay.evaluate(node => node.innerText !== '$0.00');

    await page.locator('#firstName').fill('Test');
    await page.locator('#lastName').fill('User');
    await page.locator('#email').fill('customer@example.com');
    await page.locator('#phone').fill('555-0123');

    await page.locator('#address').fill('123 Test St');
    await page.locator('#city').fill('Test City');
    await page.locator('#state').fill('TS');
    await page.locator('#postalCode').fill('12345');

    const submitBtn = page.locator('#submitPaymentBtn');
    await submitBtn.waitFor({ state: 'visible' });
    
    // Evaluate validity before clicking
    const isFormValid = await page.evaluate(() => document.getElementById('payment-form').checkValidity());
    console.log('Form validity before click:', isFormValid);

    await submitBtn.click();
    console.log('Clicked submit button');

    // Wait 5 seconds
    await page.waitForTimeout(5000);

    await browser.close();
})();
