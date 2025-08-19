import { test, expect } from './test-setup.js';

test('allows a user to add text to an image', async ({ page }) => {
  await page.goto('/');

  // --- Step 1: Open the editor and upload an image ---
  await page.locator('#get-started-prompt').click();
  await expect(page.locator('#editor-modal')).toBeVisible();

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('input#design-image-upload').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('verification/test.png');

  // --- Step 2: Verify the image loaded and controls are ready ---
  // Wait for the text input to be enabled as a sign that processing is done.
  await expect(page.locator('#textInput')).toBeEnabled({ timeout: 10000 });

  // --- Step 3: Add text ---
  await page.locator('#textInput').fill('Hello, World!');
  await page.locator('#addTextBtn').click();

  // --- Step 4: Close the modal ---
  await page.locator('#ok-edit-btn').click();
  await expect(page.locator('#editor-modal')).toBeHidden();


  // --- Step 5: Verify the text was added to the canvas ---
  // The screenshot serves as visual verification.
  await page.locator('#imageCanvas').screenshot({ path: 'test-results/add-text-canvas.png' });
});
