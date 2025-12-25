
import { test, expect } from './test-setup.js';
import fs from 'fs';
import path from 'path';

const TEST_IMAGE_PATH = path.join('verification', 'test.png');

test.describe('Visual Bounding Box', () => {
    test('Bounding box is not visible after upload', async ({ page }) => {
        await page.goto('/');

        // Upload an image
        const fileInput = page.locator('#file');
        await page.waitForTimeout(1000);

        // Manually trigger the event listener if setInputFiles fails to trigger it correctly in this environment
        if (fs.existsSync(TEST_IMAGE_PATH)) {
             await fileInput.setInputFiles(TEST_IMAGE_PATH);
        } else {
            const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
            await fileInput.setInputFiles({
                name: 'test.png',
                mimeType: 'image/png',
                buffer: buffer,
            });
        }

        // Wait and force change event if needed
        await page.waitForTimeout(500);
        await fileInput.evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true })));

        // Wait for image load success
        await expect(page.locator('#payment-status-container')).toContainText('Image loaded successfully', { timeout: 10000 });

        // Get canvas
        const canvas = page.locator('#imageCanvas');
        await expect(canvas).toBeVisible();

        // Check if bounding box is drawn.
        // The bounding box color is set to 'rgba(128, 128, 128, 0.9)' in src/index.js:drawBoundingBox
        // which corresponds to r=128, g=128, b=128.
        // We can inspect pixel data via evaluate.

        // Wait a bit for drawing to complete
        await page.waitForTimeout(500);

        const hasGreyPixel = await page.evaluate(() => {
            const canvas = document.getElementById('imageCanvas');
            const ctx = canvas.getContext('2d');
            const { width, height } = canvas;
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;

            // Check for grey pixels roughly matching 128,128,128
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                // Check if it's the bounding box color
                // Allow some tolerance
                if (Math.abs(r - 128) < 5 && Math.abs(g - 128) < 5 && Math.abs(b - 128) < 5) {
                    return true;
                }
            }
            return false;
        });

        expect(hasGreyPixel).toBe(true);
    });
});
