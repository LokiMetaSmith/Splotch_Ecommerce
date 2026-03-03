import { test, expect } from './test-setup.js';

test('allows a user to add text to an image', async ({ page }) => {
  await page.goto('/');

  // Wait for the app to initialize (BootStrap runs and disables/hides controls)
  // This prevents the race condition where we try to upload before listeners are attached.
  // Using toBeDisabled() on the text input is a good proxy for "BootStrap finished".
  await expect(page.locator('#textInput')).toBeDisabled();

  // --- Step 1: Upload an image ---
  // Use setInputFiles for a more direct and reliable file upload simulation.
  // We use a file that is guaranteed to exist in the repository.
  await page.locator('input#file').setInputFiles('favicon.png');

  // --- Step 2: Verify the image loaded successfully ---
  // Wait for the text input to be enabled as a sign that processing is done.
  await expect(page.locator('#textInput')).toBeEnabled({ timeout: 20000 });

  // --- Step 3: Add text ---
  await page.locator('#textInput').fill('Hello, World!');
  await page.locator('#addTextBtn').click();

  // --- Step 4: Verify the text was added ---
  // Verify the success message appears in the payment status container.
  const statusContainer = page.locator('.message-content');
  await expect(statusContainer).toBeVisible({ timeout: 10000 });
  await expect(statusContainer).toContainText('Text "Hello, World!" added.', { timeout: 10000 });

  // Take a screenshot of the canvas to verify the text is displayed.
  await page.locator('#imageCanvas').screenshot({ path: 'test-results/add-text-canvas.png' });
});
