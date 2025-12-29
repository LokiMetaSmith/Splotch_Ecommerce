import { test, expect } from './test-setup.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('bounding box is visible when scaling image', async ({ page }) => {
  // --- ROBUST LOGGING SETUP ---
  page.on('console', msg => {
      const type = msg.type();
      if (type === 'error') {
          console.error(`[BROWSER ERROR] ${msg.text()}`);
      } else {
          console.log(`[BROWSER LOG] ${msg.text()}`);
      }
  });

  page.on('pageerror', err => {
      console.error(`[BROWSER UNCAUGHT EXCEPTION] ${err.message}`);
      console.error(err.stack);
  });

  page.on('requestfailed', request => {
      console.error(`[NETWORK FAIL] ${request.url()} ${request.failure()?.errorText}`);
  });
  // -----------------------------

  // Ensure verification directory exists
  const verificationDir = path.resolve(__dirname, '../verification');
  if (!fs.existsSync(verificationDir)) {
      fs.mkdirSync(verificationDir, { recursive: true });
  }

  // Create a proper 100x100 image if it doesn't exist
  // This is a 100x100 white square PNG
  const filePath = path.join(verificationDir, 'test.png');
  if (!fs.existsSync(filePath)) {
      const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAXSURBVHhe7cExAQAAAMKg9U9tCy8gAAAAXP4D2AABY6YxpgAAAABJRU5ErkJggg==', 'base64');
      fs.writeFileSync(filePath, buffer);
  }

  await page.goto('/');

  console.log(`[TEST] Uploading file from: ${filePath}`);

  // Directly target the file input.
  await page.locator('input[type="file"][id="file"]').setInputFiles(filePath);

  // Wait for the success message to confirm processing started/finished
  const statusContainer = page.locator('#payment-status-container');
  await expect(statusContainer).toContainText('Image loaded successfully', { timeout: 10000 });
  console.log('[TEST] Image loaded successfully message detected.');

  // Double check buttons are enabled
  await expect(page.locator('#rotateLeftBtn')).toBeEnabled({ timeout: 5000 });
  console.log('[TEST] UI buttons are enabled.');

  // Get the canvas
  const canvas = page.locator('#imageCanvas');
  await expect(canvas).toBeVisible();

  // Use the slider to resize
  const slider = page.locator('#resizeSlider');
  console.log('[TEST] Filling resize slider...');
  await slider.fill('3');
  console.log('[TEST] Dispatching input event to slider...');
  await slider.dispatchEvent('input');

  // Wait a bit for redraw
  await page.waitForTimeout(1000);

  const debugInfo = await page.evaluate(() => {
    const canvas = document.getElementById('imageCanvas');
    const ctx = canvas.getContext('2d');

    // Sample a few pixels around the top-left corner
    const imageData = ctx.getImageData(0, 0, 10, 10);
    const data = imageData.data;

    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
      pixels.push(`[${data[i]}, ${data[i+1]}, ${data[i+2]}, ${data[i+3]}]`);
    }

    return {
      pixels: pixels.slice(0, 20), // First 20 pixels
      width: canvas.width,
      height: canvas.height,
      lineWidth: ctx.lineWidth,
      strokeStyle: ctx.strokeStyle,
      pricingConfigLoaded: !!window.pricingConfig
    };
  });

  console.log('Canvas Debug Info:', debugInfo);

  // Check a few points along the edge where the bounding box should be.
  const isBoundingBoxVisible = await page.evaluate(() => {
    const canvas = document.getElementById('imageCanvas');
    const ctx = canvas.getContext('2d');

    const imageData = ctx.getImageData(0, 0, 10, 10);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];
      const a = data[i+3];

      // Check for grey-ish color (128, 128, 128)
      // Allow broader tolerance for alpha blending (approx 140 on white)
      const matchesBase = Math.abs(r - 128) < 20 && Math.abs(g - 128) < 20 && Math.abs(b - 128) < 20;
      const matchesBlended = Math.abs(r - 140) < 15 && Math.abs(g - 140) < 15 && Math.abs(b - 140) < 15;

      if ((matchesBase || matchesBlended) && a > 50) {
        return true;
      }
    }
    return false;
  });

  expect(isBoundingBoxVisible).toBe(true);
});
