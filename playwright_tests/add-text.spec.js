import { test, expect } from './test-setup.js';

test('allows a user to add text to an image', async ({ page }) => {
  await page.goto('/');

  // First, upload an image to enable the text editing controls.
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('label[for="file"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('verification/test.png');
  await expect(page.locator('#textInput')).toBeEnabled();

  // Now, add text.
  await page.locator('#textInput').fill('Hello, World!');
  await page.locator('#addTextBtn').click();

  // Verify that the text was added.
  await expect(page.locator('#payment-status-container')).toContainText('Text "Hello, World!" added.');

  // Take a screenshot of the canvas to verify the text is displayed.
  await expect(page.locator('#imageCanvas')).screenshot();
});
