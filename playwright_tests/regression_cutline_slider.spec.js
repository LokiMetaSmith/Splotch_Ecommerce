import { test, expect } from './test-setup.js';
import fs from 'fs';
import path from 'path';

const TEST_IMAGE_PATH = 'favicon.png';

test('Cutline Slider features - Magic Edge / Offset / Lazy Lasso', async ({ page }) => {
    await page.goto('/');

    const fileInput = page.locator('#file');
    await page.waitForTimeout(1000);
    await fileInput.setInputFiles(TEST_IMAGE_PATH);

    await expect(page.locator('.message-content').last()).toContainText('Image loaded successfully', { timeout: 10000 });

    // By default, advanced controls are hidden. "Magic Edge" slider is visible instead of Cutline Offset.
    const magicEdgeSlider = page.locator('#cutlineOffsetSlider');
    await expect(magicEdgeSlider).toBeVisible();

    const lazyLassoSlider = page.locator('#lazyLassoSlider');
    await expect(lazyLassoSlider).not.toBeVisible();

    // Unlock advanced features
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('easterEggUnlocked')));

    // Now Cutline Offset and Lazy Lasso should be visible
    await expect(magicEdgeSlider).toBeVisible(); // This slider changes meaning but keeps ID
    await expect(lazyLassoSlider).toBeVisible();

});
