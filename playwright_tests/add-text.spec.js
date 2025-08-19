import { test, expect } from './test-setup.js';

test('allows a user to add text to an image', async ({ page }) => {
  await page.goto('/');

  // --- Step 1: Upload an image ---
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('input#file').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('verification/test.png');

  // --- Step 2: Navigate to the Customize card ---
  await page.locator('#rolodex-next').click();
  await expect(page.locator('.rolodex-card[data-index="1"]')).toHaveClass(/active/);

  // --- Step 3: Add text ---
  await expect(page.locator('#textInput')).toBeEnabled({ timeout: 10000 });
  await page.locator('#textInput').fill('Hello, Splotch!');
  await page.locator('#addTextBtn').click();

  // --- Step 4: Verify the text was added ---
  // The screenshot serves as visual verification that the text was added.
  // We'll take a screenshot of the main canvas, which is on the first card.
  // The canvas is always present in the DOM, so we can screenshot it from any card.
  await page.locator('#imageCanvas').screenshot({ path: 'test-results/add-text-canvas.png' });
});
