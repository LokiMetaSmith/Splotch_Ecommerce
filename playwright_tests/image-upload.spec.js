import { test, expect } from '@playwright/test';

test.describe('Image Upload', () => {
  test.describe('Desktop', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('allows a user to upload an image and enables editing', async ({ page }) => {
      await page.goto('/');
      const canvas = page.locator('#imageCanvas');
      const initialScreenshot = await canvas.screenshot();

      await page.locator('#file').setInputFiles('verification/test.png');
      await expect(page.locator('#rotateLeftBtn')).toBeEnabled({ timeout: 10000 });

      await expect(async () => {
        expect(await canvas.screenshot()).not.toEqual(initialScreenshot);
      }).toPass({ timeout: 10000 });
    });
  });

  test.describe('Mobile', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('allows a user to upload an image and enables editing', async ({ page }) => {
      await page.goto('/');
      const canvas = page.locator('#imageCanvas');
      const initialScreenshot = await canvas.screenshot();

      await page.locator('#file').setInputFiles('verification/test.png');
      await expect(page.locator('#rotateLeftBtn')).toBeEnabled({ timeout: 10000 });

      await page.waitForTimeout(1000); // Add a small delay for mobile

      await expect(async () => {
        expect(await canvas.screenshot()).not.toEqual(initialScreenshot);
      }).toPass({ timeout: 10000 });
    });
  });
});
