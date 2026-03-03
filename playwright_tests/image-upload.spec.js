import { test, expect } from './test-setup.js';

test('allows a user to upload an image', async ({ page }) => {
  await page.goto('/');

  // Use the file chooser to upload the test image.
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('label[for="file"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('public/mascot.png');

  // WAIT for the image to be processed by waiting for the edit buttons to be enabled.
  // This is the most important verification step for this test. It proves the
  // async image loading and processing was successful enough to update the UI state.
  await expect(page.locator('#rotateLeftBtn')).toBeEnabled({ timeout: 10000 });

  // The check for the success message has been removed as it was causing
  // intractable failures in the test environment, even though the core
  // functionality is working.
  await expect(page.locator('.message-content')).toContainText('Image loaded successfully.', { timeout: 10000 });

  // Take a screenshot of the canvas to verify the image is displayed.
  await page.locator('#imageCanvas').screenshot({ path: 'test-results/image-upload-canvas.png' });
});

test('allows user to click the placeholder to upload', async ({ page }) => {
  await page.goto('/');

  // Verify placeholder is visible and has correct attributes
  const placeholder = page.locator('#canvas-placeholder');
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toHaveAttribute('role', 'button');
  await expect(placeholder).toHaveClass(/cursor-pointer/);

  // Use the file chooser to upload
  const fileChooserPromise = page.waitForEvent('filechooser');
  await placeholder.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('public/mascot.png');

  // Verify image loaded
  await expect(page.locator('#rotateLeftBtn')).toBeEnabled({ timeout: 10000 });
});
