// playwright_tests/image-manipulation.spec.js
import { test, expect } from './test-setup.js'; // Use the extended test fixture
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Frontend Image Manipulation', () => {

    test.beforeEach(async ({ page }) => {
        // The autoMock fixture handles mocks
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('pageerror', err => console.log('PAGE ERROR:', err));
        await page.goto('/');
    });

    // Helper to upload a test image
    async function uploadTestImage(page) {
        // Create a temporary test image if it doesn't exist
        const testImagePath = path.join(__dirname, '../verification/test.png');

        // Always overwrite to ensure we have a valid known image (10x10 red square)
        const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAGElEQVR42mP8z8DwHwMIMDIgA0w00UgAAJ9AA/2R+2O2AAAAAElFTkSuQmCC', 'base64');

        if (!fs.existsSync(path.dirname(testImagePath))) {
            fs.mkdirSync(path.dirname(testImagePath), { recursive: true });
        }
        fs.writeFileSync(testImagePath, buffer);

        // Wait for input to be present and attach listener
        // Make the selector more specific to target only the main image upload input
        const fileInput = page.locator('input#file');

        // Sometimes listeners aren't ready immediately upon load
        await page.waitForTimeout(1000);

        await fileInput.setInputFiles(testImagePath);

        // Wait for image to load
        await expect(page.locator('.message-content')).toContainText('Image loaded successfully');
    }

    test('should add text to the canvas', async ({ page }) => {
        await uploadTestImage(page);

        // Fill text input
        await page.fill('#textInput', 'Hello World');
        await page.fill('#textSizeInput', '50');
        await page.fill('#textColorInput', '#000000');

        // Click Add Text button
        await page.click('#addTextBtn');

        // Verify success message
        await expect(page.locator('.message-content')).toContainText('Text "Hello World" added');
    });

    test('should rotate the image', async ({ page }) => {
        await uploadTestImage(page);

        await page.click('#rotateRightBtn');
        // Wait a bit for potential async operations
        await page.waitForTimeout(100);

        // If we rotate again
        await page.click('#rotateRightBtn');
        await page.waitForTimeout(100);
    });

    test('should apply grayscale filter', async ({ page }) => {
        await uploadTestImage(page);

        await page.click('#grayscaleBtn');
        // Wait a bit
        await page.waitForTimeout(100);

        await page.click('#grayscaleBtn');
        await page.waitForTimeout(100);
    });

    test('should generate smart cutline', async ({ page }) => {
        // Mock the confirm dialog to always accept
        page.on('dialog', dialog => dialog.accept());

        // Use a larger test image (100x100)
        // This ensures the "Smart Cutline" logic has a clear boundary to trace and isn't filtered out by cleanup steps.
        const testImagePath = path.join(__dirname, '../verification/test_transparent.png');

        // 100x100 PNG. Transparent background with red square in center (50x50).
        // This ensures corners are transparent (background detection) and center is red (contour).
        const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAoElEQVR4Ae3BgQ2AMAADoK7//6xXaJoFCAAAAAAAAAAAANzs5AdP8uQCJzn5WMOUhikNUxqmNExpmNIwpWFKw5SGKQ1TGqY0TGmY0jClYUrDlIYpDVMapjRMaZjSMKVhSsOUhikNUxqmNExpmNIwpWFKw5SGKQ1TGqY0TGmY0jClYUrDlIYpDVMapjRMaZjSMKVhSgMAAAAAAAAAAADwlxdEegJknr12MAAAAABJRU5ErkJggg==', 'base64');

        if (!fs.existsSync(path.dirname(testImagePath))) {
            fs.mkdirSync(path.dirname(testImagePath), { recursive: true });
        }
        fs.writeFileSync(testImagePath, buffer);

        const fileInput = page.locator('input#file');
        await page.waitForTimeout(1000);
        await fileInput.setInputFiles(testImagePath);
        await expect(page.locator('.message-content')).toContainText('Image loaded successfully');

        // Click Generate Cutline
        const generateBtn = page.locator('#generateCutlineBtn');
        await expect(generateBtn).toBeVisible();

        // Wait a bit for canvas rendering on slower devices (like mobile safari in CI)
        await page.waitForTimeout(1000);

        // Expect success message
        await generateBtn.click();
        await expect(page.locator('.message-content')).toContainText('Smart cutline generated successfully', { timeout: 10000 });
    });
});
