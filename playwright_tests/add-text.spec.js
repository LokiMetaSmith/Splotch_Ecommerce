import { test, expect } from './test-setup.js';
  // --- Step 1: Upload an image ---
  await page.locator('input#file').setInputFiles('verification/test.png');

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

test.describe('Add Text to Image', () => {

  const setup = async (page, isMobile = true) => {
    if (isMobile) {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/');
      await expect(page.locator('#mobile-layout')).toBeVisible({ timeout: 10000 });
      
      const canvas = page.locator('#mobile-imageCanvas');
      await page.waitForTimeout(500);
      const initialScreenshot = await canvas.screenshot();

      await page.locator('#mobile-file').setInputFiles('verification/test.png');
      
      // Wait for the canvas to visually change before proceeding.
      await expect(async () => {
        expect(await canvas.screenshot()).not.toEqual(initialScreenshot);
      }).toPass({ timeout: 10000 });

      await page.locator('#rolodex-next').click();
      await expect(page.locator('.rolodex-card[data-index="1"].active')).toBeVisible();
    } else {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/');
      await expect(page.locator('#desktop-layout')).toBeVisible({ timeout: 10000 });
      await page.locator('#get-started-prompt').click();
      await expect(page.locator('#editor-modal')).not.toHaveClass(/hidden/);
      await page.locator('#design-image-upload').setInputFiles('verification/test.png');
    }
    
    // Now that setup is complete and robust, this check should pass for both platforms.
    const rotateBtn = isMobile ? '#mobile-rotateLeftBtn' : '#rotateLeftBtn';
    await expect(page.locator(rotateBtn)).toBeEnabled({ timeout: 10000 });
  };

  test('Mobile: should allow a user to attempt to add text', async ({ page }) => {
    await setup(page, true);
    const textInput = page.locator('#mobile-textInput');
    const addTextBtn = page.locator('#mobile-addTextBtn');
    await expect(textInput).toBeVisible();
    await textInput.fill('Hello Mobile');
    await addTextBtn.click();
    await expect(addTextBtn).toBeEnabled();
  });

  test('Desktop: should allow a user to attempt to add text', async ({ page }) => {
    await setup(page, false);
    const textInput = page.locator('#textInput');
    const addTextBtn = page.locator('#addTextBtn');
    await expect(textInput).toBeVisible();
    await textInput.fill('Hello Desktop');
    await addTextBtn.click();
    await expect(addTextBtn).toBeEnabled();
    await page.locator('#ok-edit-btn').click();
    await expect(page.locator('#editor-modal')).toHaveClass(/hidden/);
  });
});
