
import { test, expect } from './test-setup.js';
import fs from 'fs';
import path from 'path';

const TEST_IMAGE_PATH = 'favicon.png';

test('Generate Smart Cutline should preserve the original image', async ({ page }) => {
    await page.goto('/');

    const fileInput = page.locator('#file');

    // Wait for app init
    await page.waitForTimeout(1000);

    // Upload Image
    await fileInput.setInputFiles(TEST_IMAGE_PATH);

    // Wait for image load success
    await expect(page.locator('#payment-status-container')).toContainText('Image loaded successfully', { timeout: 10000 });

    // Verify canvas has pixels (favicon usually has some color)
    const hasColorBefore = await page.evaluate(() => {
        const canvas = document.getElementById('imageCanvas');
        const ctx = canvas.getContext('2d');
        // Sample center
        const pixel = ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
        // Check if not empty/transparent/black
        return pixel[3] > 0; // Alpha > 0
    });

    // Handle potential confirm dialog
    page.on('dialog', async dialog => {
        console.log(`Dialog message: ${dialog.message()}`);
        await dialog.accept();
    });

    // Click Generate Smart Cutline
    const generateBtn = page.locator('#generateCutlineBtn');
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // Wait for success
    await expect(page.locator('#payment-status-container')).toContainText('Smart cutline generated successfully', { timeout: 15000 });

    // Check pixel again
    const isNotBlack = await page.evaluate(() => {
        const canvas = document.getElementById('imageCanvas');
        const ctx = canvas.getContext('2d');
        const pixel = ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
        // If it was replaced by a black polygon, it should be black (0,0,0,255).
        // If preserved, it should be colorful.
        // We check if any RGB channel is non-zero.
        return pixel[0] > 0 || pixel[1] > 0 || pixel[2] > 0;
    });

    expect(isNotBlack).toBe(true);
});
