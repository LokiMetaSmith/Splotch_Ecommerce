import { test, expect } from './test-setup.js';

test('allows a user to upload an image', async ({ page }) => {
  await page.goto('/');

  // Use the file chooser to upload the test image.
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('label[for="file"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('verification/test.png');

  // Wait for the image to be loaded onto the canvas.
  await expect(page.locator('#payment-status-container')).toContainText('Image loaded successfully.');

  // Take a screenshot of the canvas to verify the image is displayed.
  await expect(page.locator('#imageCanvas')).screenshot();
});
