import { test, expect } from '@playwright/test';

test.describe('Image Upload', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Desktop: allows a user to upload an image and enables editing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForLoadState('networkidle');

    // In desktop view, uploading happens via the main file input
    await page.locator('input[type="file"]').first().setInputFiles('verification/test.png');

    // After upload, the editing buttons should be enabled immediately.
    await expect(page.locator('#rotateLeftBtn')).toBeEnabled({ timeout: 10000 });
  });

  test('Mobile: allows a user to upload an image and enables editing', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForLoadState('networkidle');
    
    const canvas = page.locator('#mobile-imageCanvas-thumb');
    
    // Allow a moment for the initial blank canvas to render fully.
    await page.waitForTimeout(500); 
    const initialScreenshot = await canvas.screenshot();

    // Upload the file. The input is not visible, but we can still use it.
    await page.locator('input[type="file"]').first().setInputFiles('verification/test.png');

    // Wait for the canvas to change from its initial state. This confirms image load.
    await expect(async () => {
      expect(await canvas.screenshot()).not.toEqual(initialScreenshot);
    }).toPass({ timeout: 10000 });

    // Now that the image is loaded, navigate and verify buttons are enabled.
    await page.locator('#rolodex-next').click();
    await expect(page.locator('.rolodex-card[data-index="1"].active')).toBeVisible();
    await expect(page.locator('#mobile-rotateLeftBtn')).toBeEnabled();
  });
});
