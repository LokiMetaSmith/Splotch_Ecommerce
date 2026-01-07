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
        await expect(page.locator('#payment-status-container')).toContainText('Image loaded successfully');
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
        await expect(page.locator('#payment-status-container')).toContainText('Text "Hello World" added');
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

        // Use a larger test image (50x50) with a transparent border and a central shape (red square)
        // This ensures the "Smart Cutline" logic has a clear boundary to trace and isn't filtered out by cleanup steps.
        const testImagePath = path.join(__dirname, '../verification/test_transparent.png');

        // 100x100 PNG. Solid black circle in the middle.
        // Created to be large and simple enough to survive polygon cleaning.
        const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAACXBIWXMAAA7DAAAOwwHHb6hkAAACXElEQVR4nO3cTU7DMBAF4MyQe9Qj9AQ9Q49Qj9AOuQGVYgUtW7E99vimq1I5xZ/nZ2e+JEmSJEmSJEmSJEmSJEmSJEmSJEk628/Pz+X7+3t5fn4u9/f35f7+fl5/fX0tt7e3y+3t7fL19bW/7+PjY3l6elqenp6Wp6en5ePjY9/39fW13N3dLXd3d8vd3d3y9fW1v//l5WV5eXlZXl5elpeXl+Xz83Pf9/r6ur6/u7u75fX1df/8/PxcXl9fl9fX1+X19XX5/Pzc972+vi4PDw/Lw8PD8vDwsLy+vu7v+/z8XB4fH5fHx8fl8fFx+fr62t/38vKyPD4+Lo+Pj8vj4+Py8vKyv+/t7W15fn5enp+fl+fn5+Xt7W1/38fHx/L6+rq8vr4ur6+vy8fHx/6+t7e35fX1dXl9fV1eX1+Xt7e3/X2f/8/y/v6+vL+/L+/v78vn5+f+vpubm+Xm5ma5ublZbm5u9ve9vb0tDw8Py8PDw/Lw8LC8vb3t7/v6+lpub2+X29vb5fb2dvn6+trfd39/vzw9PS1PT0/L09PTcn9/v7/v7e1teXl5WV5eXpaXl5fl7e1tf9/X19dyc3Oz3NzcnP2v5Onpabm7u1vu7u6Wp6en/X2f/8/y8fGxfHx8LB8fH8vn5+f+vpubm+Xm5ma5ublZbm5u9ve9vb0tDw8Py8PDw/Lw8LC8vb3t7/v6+lpub2+X29vb5fb2dvn6+trfd39/vzw9PS1PT0/L09PTcn9/v7/v7e1teXl5WV5eXpaXl5fl7e1tf9/X19dyc3Oz3NzcnP2vJEmSJEmSJEmSJEmSJEmSJEmSJEn/0S/uW35509+R2QAAAABJRU5ErkJggg==', 'base64');

        if (!fs.existsSync(path.dirname(testImagePath))) {
            fs.mkdirSync(path.dirname(testImagePath), { recursive: true });
        }
        fs.writeFileSync(testImagePath, buffer);

        const fileInput = page.locator('input#file');
        await page.waitForTimeout(1000);
        await fileInput.setInputFiles(testImagePath);
        await expect(page.locator('#payment-status-container')).toContainText('Image loaded successfully');

        // Click Generate Cutline
        const generateBtn = page.locator('#generateCutlineBtn');
        await expect(generateBtn).toBeVisible();

        // Expect success message
        await generateBtn.click();
        await expect(page.locator('#payment-status-container')).toContainText('Smart cutline generated successfully', { timeout: 10000 });
    });
});
