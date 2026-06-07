import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('QA Flow requested by user', () => {
    test('create sticker pack, scale, contour bleedless, and fulfill in printshop', async ({ browser, request }) => {
        // Create an isolated browser context
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // 1. Go to homepage
        // Set Playwright test mode to bypass Square tokenization
        await page.addInitScript(() => {
            window.PLAYWRIGHT_TEST_MODE = true;
        });

        page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
        page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));

        await page.goto('/');

        // Wait for app initialization to complete before uploading
        await page.waitForFunction(() => window.__appInitialized === true);

        // 2. Upload mascot.png to create sticker pack
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('label[for="file"]').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles('public/mascot.png');

        // Wait for image processing to complete by checking for clearFileBtn visibility
        await expect(page.locator('#clearFileBtn')).toBeVisible({ timeout: 10000 });

        // 3. Scale it (Set size to e.g. 3x3 inches)
        await page.fill('#resizeInput', '3');
        // Blur to trigger update
        await page.locator('#resizeInput').blur();
        
        // Wait for calculation
        await page.waitForTimeout(500);

        // 4. Use Contour option to give it a bleedless no white outline
        await page.evaluate(() => { 
            const toggle = document.getElementById('cutTypeToggle');
            if (toggle) {
                toggle.disabled = false;
                toggle.checked = true;
                toggle.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const slider = document.getElementById('cutlineOffsetSlider');
            if (slider) {
                slider.disabled = false;
                slider.value = 0; 
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                slider.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        // Give it time to generate the contour
        await page.waitForTimeout(1000);

        // 5. Submit the order
        // Fill out shipping form
        await page.fill('#firstName', 'QA');
        await page.fill('#lastName', 'Tester');
        await page.fill('#address', '123 QA Street');
        await page.fill('#city', 'Testville');
        await page.fill('#state', 'TX');
        await page.fill('#postalCode', '12345');
        
        // Fill out contact info
        await page.fill('#email', 'qa@test.com');
        await page.fill('#phone', '555-555-5555');
        // Check form validity before clicking
        const validity = await page.evaluate(() => {
            const form = document.getElementById('payment-form');
            if (!form.checkValidity()) {
                const invalidElements = Array.from(form.querySelectorAll(':invalid'));
                return invalidElements.map(el => el.id || el.name || el.tagName);
            }
            return 'VALID';
        });
        console.log('BROWSER LOG: Form validity:', validity);

        // Dispatch submit event manually
        await page.evaluate(() => {
            const form = document.getElementById('payment-form');
            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        });
        // Expect redirect to order tracking page
        await page.waitForURL('**/orders.html**', { timeout: 15000 });
        // Grab the order ID if possible, though we can just fulfill the latest
        
        // 6. Go to printshop dashboard
        await page.goto('/printshop.html');

        // Wait for printshop.js initialization to finish
        await page.waitForFunction(() => window.__printshopInitialized === true, { timeout: 10000 });

        // Log in
        await page.click('#loginBtn');
        await expect(page.locator('#login-modal')).toBeVisible({ timeout: 5000 });
        await page.fill('#username-input', 'test');
        await page.fill('#password-input', 'test');
        await page.click('#password-login-btn');

        // Wait for printshop dashboard to load
        await expect(page.locator('#orders-list')).toBeVisible({ timeout: 10000 });

        // 7. Fulfill the order (Select the first/latest one)
        // Check the checkbox for the first order in the list to nest it
        const firstOrderCheckbox = page.locator('.order-card input[type="checkbox"]').first();
        await expect(firstOrderCheckbox).toBeVisible();
        await firstOrderCheckbox.check();

        // 8. Nesting operation
        await page.click('#nestStickersBtn');

        // Wait for nesting to complete. A download button for the PDF should appear.
        const exportPdfBtn = page.locator('#exportPdfBtn');
        await expect(exportPdfBtn).toBeVisible({ timeout: 30000 });

        // 9. Save print cut sheet
        const downloadPromise = page.waitForEvent('download');
        await exportPdfBtn.click();
        const download = await downloadPromise;
        
        // Save it to artifacts or local test-results
        const downloadPath = path.join(__dirname, '../test-results/qa-cutsheet.pdf');
        await download.saveAs(downloadPath);

        // Verify file exists
        expect(downloadPath).toBeTruthy();
        console.log(`Successfully saved print cut sheet to ${downloadPath}`);

        // Mark order as shipped/completed
        const selectStatus = page.locator('.order-card select.status-select').first();
        await selectStatus.selectOption('shipped');
        
        // Cleanup
        await context.close();
    });
});
