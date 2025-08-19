import { test, expect } from './test-setup.js';

test('allows a user to upload an image and enables editing', async ({ page }) => {
  await page.goto('/');

  // Card 1: Upload & Preview should be active by default
  await expect(page.locator('.rolodex-card[data-index="0"]')).toHaveClass(/active/);

  // Use the file chooser to upload the test image.
  await page.locator('input#file').setInputFiles('verification/test.png');

  // After upload, the edit buttons should be enabled.
  // We need to navigate to the second card to check this.
  await page.locator('#rolodex-next').click();

  // Card 2: Customize should now be active
  await expect(page.locator('.rolodex-card[data-index="1"]')).toHaveClass(/active/);

  // This is the most important verification step for this test. It proves the
  // async image loading and processing was successful enough to update the UI state.
  await expect(page.locator('#rotateLeftBtn')).toBeEnabled({ timeout: 10000 });
  await expect(page.locator('#addTextBtn')).toBeEnabled({ timeout: 10000 });

  // Take a screenshot of the canvas to verify the image is displayed.
  await page.locator('#imageCanvas').screenshot({ path: 'test-results/image-upload-canvas.png' });
});
