import { test, expect } from './test-setup.js';
import path from 'path';
import fs from 'fs';

test.describe('Payment Form Flow', () => {
  const verificationDir = path.join(process.cwd(), 'verification');
  const testImagePath = path.join(verificationDir, 'test.png');

  test.beforeAll(async () => {
    // Ensure verification directory and test image exist
    if (!fs.existsSync(verificationDir)) {
      fs.mkdirSync(verificationDir, { recursive: true });
    }
    // Create a simple 1x1 transparent PNG
    const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    fs.writeFileSync(testImagePath, Buffer.from(base64Png, 'base64'));
  });

  test.afterAll(async () => {
    // Cleanup
    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }
    if (fs.existsSync(verificationDir) && fs.readdirSync(verificationDir).length === 0) {
      fs.rmdirSync(verificationDir);
    }
  });

  test('allows a user to submit the payment form', async ({ page }) => {
    await page.goto('/');

    // 1. Upload an image
    // Ensure the file input is ready
    await expect(page.locator('#file')).toBeVisible();

    // Set input files triggers the necessary events
    await page.setInputFiles('#file', testImagePath);

    // 2. Wait for image processing to complete
    // The app shows a success message when the image is loaded
    await expect(page.locator('#payment-status-container')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#payment-status-container')).toContainText('Image loaded successfully');

    // 3. Fill out the billing form
    await page.fill('#firstName', 'Test');
    await page.fill('#lastName', 'User');
    await page.fill('#email', 'test@example.com');
    await page.fill('#phone', '555-0123');
    await page.fill('#address', '123 Test St');
    await page.fill('#city', 'Test City');
    await page.fill('#state', 'TS');
    await page.fill('#postalCode', '12345');

    // 4. Submit the form
    await page.click('button[type="submit"]');

    // 5. Verify processing status
    // Wait for the status container to be visible (it might be visible from previous step, so we check content)
    await expect(page.locator('#payment-status-container')).toBeVisible();

    // 6. Verify success message
    await expect(page.locator('#payment-status-container')).toContainText('Order successfully placed!', { timeout: 10000 });

    // 7. Verify redirection to orders page
    await page.waitForURL('**/orders.html?token=mock-temp-auth-token-xyz', { timeout: 10000 });
  });
});
