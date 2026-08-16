import { test, expect } from '../playwright_tests/test-setup.js';
import path from 'path';
import fs from 'fs';

test.describe('Boundary Layer UI and Multi-Layer SVG Export', () => {
    const testImagePath = path.join(process.cwd(), 'public', 'mascot.png');

    test('should show boundary settings, update config, and export grouped SVG', async ({ page }) => {
        page.on('console', msg => {
            console.log('PAGE LOG:', msg.text());
        });
        page.on('pageerror', err => {
            console.log('PAGE ERROR:', err.message);
        });
        await page.goto('/');
        await expect(page.locator('#file')).toBeVisible();
        await page.setInputFiles('#file', testImagePath);
        await expect(page.locator('.message-content').last()).toBeVisible({ timeout: 10000 });

        // Wait for the async worker to finish generating the initial cutline
        await page.waitForTimeout(3000);

        // Wait for Sheet Boundary to be appended
        const boundaryLi = page.locator('#layer-list li').filter({ hasText: 'Sheet Boundary' });
        await expect(boundaryLi).toBeVisible({ timeout: 10000 });

        await boundaryLi.click();

        const boundaryPanel = page.locator('#boundary-settings-panel');
        await expect(boundaryPanel).toBeVisible();

        await page.selectOption('#boundaryShapeSelect', 'square');
        await page.fill('#boundaryMarginInput', '0.25');
        await page.dispatchEvent('#boundaryMarginInput', 'input');

        // Wait for debounced boundary generation to complete
        await page.waitForTimeout(1000);

        await page.fill('#firstName', 'Test');
        await page.fill('#lastName', 'User');
        await page.fill('#email', 'test@example.com');
        await page.fill('#phone', '555-0123');
        await page.fill('#address', '123 Test St');
        await page.fill('#city', 'Test City');
        await page.fill('#state', 'TS');
        await page.fill('#postalCode', '12345');

        let interceptedSVG = '';
        page.on('request', request => {
            if (request.url().includes('/api/upload-design') && request.method() === 'POST') {
                interceptedSVG = request.postData() || '';
                console.log("INTERCEPTED UPLOAD POST DATA LENGTH:", interceptedSVG.length);
            }
        });

        await page.click('form#payment-form button[type="submit"]');

        await page.waitForResponse(resp => resp.url().includes('/api/upload-design') && resp.status() === 200, { timeout: 15000 });

        console.log("TEST FINISHED WAITING FOR RESPONSE");

        expect(interceptedSVG).toContain('Kiss-Cut');
        expect(interceptedSVG).toContain('Die-Cut');
    });
});
