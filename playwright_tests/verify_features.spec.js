
import { test, expect } from './test-setup.js';
import fs from 'fs';
import path from 'path';

const TEST_IMAGE_PATH = path.join('verification', 'test_features.png');

test.beforeAll(() => {
    if (!fs.existsSync(TEST_IMAGE_PATH)) {
        const dir = path.dirname(TEST_IMAGE_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Create a dummy image (red pixel)
        const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        fs.writeFileSync(TEST_IMAGE_PATH, buffer);
    }
});

test.afterAll(() => {
    if (fs.existsSync(TEST_IMAGE_PATH)) {
        fs.unlinkSync(TEST_IMAGE_PATH);
    }
});

test.describe('Standard Size Buttons and Unit Selection', () => {
    test('Standard Size Buttons update resize slider', async ({ page }) => {
        await page.goto('/');

        // Upload an image to enable controls
        // Use the ID selector to be specific, as there are multiple file inputs
        const fileInput = page.locator('#file');

        // Wait for the app to be ready (listeners attached)
        await page.waitForTimeout(1000);

        // We need a real file.
        await fileInput.setInputFiles(TEST_IMAGE_PATH);

        // Wait for image to load and controls to be enabled
        await expect(page.locator('#resizeSlider')).toBeEnabled();

        // Locate the buttons
        const btn1 = page.locator('button.size-btn[data-size="1"]');
        const btn2 = page.locator('button.size-btn[data-size="2"]');
        const btn3 = page.locator('button.size-btn[data-size="3"]');

        await expect(btn1).toBeVisible();
        await expect(btn2).toBeVisible();
        await expect(btn3).toBeVisible();

        // Wait for success message to ensure image is loaded and controls are enabled
        await expect(page.locator('#payment-status-container')).toContainText('Image loaded successfully', { timeout: 10000 });
        await expect(page.locator('#resizeSlider')).toBeEnabled();

        // Click 2" button
        await btn2.click();

        // Check if slider value matches
        await expect(page.locator('#resizeSlider')).toHaveValue('2');
        await expect(page.locator('#resizeInput')).toHaveValue('2.0');
        await expect(page.locator('#resizeUnitLabel')).toHaveText('in');

        // Click 1" button
        await btn1.click();
        await expect(page.locator('#resizeSlider')).toHaveValue('1');
        await expect(page.locator('#resizeInput')).toHaveValue('1.0');
        await expect(page.locator('#resizeUnitLabel')).toHaveText('in');

        // Click 3" button
        await btn3.click();
        await expect(page.locator('#resizeSlider')).toHaveValue('3');
        await expect(page.locator('#resizeInput')).toHaveValue('3.0');
        await expect(page.locator('#resizeUnitLabel')).toHaveText('in');
    });

    test('Unit Selection toggle updates display', async ({ page }) => {
        await page.goto('/');

        // Upload an image to enable controls
        // Use the ID selector to be specific
        const fileInput = page.locator('#file');

        // Wait for listeners
        await page.waitForTimeout(1000);

        await fileInput.setInputFiles(TEST_IMAGE_PATH);

        // Hide the mascot which obscures the toggle
        await page.evaluate(() => {
            const mascot = document.getElementById('mascot-container');
            if (mascot) mascot.style.display = 'none';
        });

        const toggle = page.locator('#unitToggle');
        const btn1 = page.locator('button.size-btn[data-size="1"]');
        const resizeUnitLabel = page.locator('#resizeUnitLabel');

        // Initial state (Inches)
        await expect(btn1).toHaveText('1"');
        await expect(resizeUnitLabel).toHaveText('in');

        // Toggle to mm via JS evaluation to avoid viewport/interception issues
        await page.evaluate(() => document.querySelector('label[for="unitToggle"]').click());

        // 1 inch = 25.4 mm => approx 25mm
        await expect(btn1).toHaveText('25mm');
        await expect(resizeUnitLabel).toHaveText('mm');

        // Toggle back to inches via JS evaluation
        await page.evaluate(() => document.querySelector('label[for="unitToggle"]').click());
        await expect(btn1).toHaveText('1"');
        await expect(resizeUnitLabel).toHaveText('in');
    });
});
