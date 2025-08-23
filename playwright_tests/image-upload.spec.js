import { test, expect } from './test-setup.js';

test.describe('Image Upload', () => {
  
  test('Mobile: allows a user to upload an image and enables editing', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.locator('#mobile-layout')).toBeVisible({ timeout: 10000 });
    
    const canvas = page.locator('#mobile-imageCanvas');
    
    // Allow a moment for the initial blank canvas to render fully.
    await page.waitForTimeout(500); 
    const initialScreenshot = await canvas.screenshot();

    // Upload the file.
    await page.locator('#mobile-file').setInputFiles('verification/test.png');

    // Wait for the canvas to change from its initial state. This confirms image load.
    await expect(async () => {
      expect(await canvas.screenshot()).not.toEqual(initialScreenshot);
    }).toPass({ timeout: 10000 });

    // Now that the image is loaded, navigate and verify buttons are enabled.
    await page.locator('#rolodex-next').click();
    await expect(page.locator('.rolodex-card[data-index="1"].active')).toBeVisible();
    await expect(page.locator('#mobile-rotateLeftBtn')).toBeEnabled();
  });

  test('Desktop: allows a user to upload an image and enables editing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.locator('#desktop-layout')).toBeVisible({ timeout: 10000 });
    await page.locator('#get-started-prompt').click();
    await expect(page.locator('#editor-modal')).not.toHaveClass(/hidden/);
    await page.locator('#design-image-upload').setInputFiles('verification/test.png');
    await expect(page.locator('#rotateLeftBtn')).toBeEnabled({ timeout: 10000 });
    await page.locator('#ok-edit-btn').click();
    await expect(page.locator('#editor-modal')).toHaveClass(/hidden/);
  });
});
