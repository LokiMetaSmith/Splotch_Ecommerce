import { test, expect } from '@playwright/test';

test.describe('Add Text to Image', () => {
  test.describe('Desktop', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('should allow a user to attempt to add text', async ({ page }) => {
      await page.goto('/');
      await page.locator('#file').setInputFiles('verification/test.png');
      await expect(page.locator('#textInput')).toBeEnabled({ timeout: 10000 });

      const canvas = page.locator('#imageCanvas');
      const initialScreenshot = await canvas.screenshot();

      await page.locator('#textInput').fill('Hello World');
      await page.locator('#addTextBtn').click();

      await expect(async () => {
        expect(await canvas.screenshot()).not.toEqual(initialScreenshot);
      }).toPass({ timeout: 10000 });
    });
  });

  test.describe('Mobile', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('should allow a user to attempt to add text', async ({ page }) => {
      await page.goto('/');
      await page.locator('#file').setInputFiles('verification/test.png');
      await expect(page.locator('#textInput')).toBeEnabled({ timeout: 10000 });

      const canvas = page.locator('#imageCanvas');
      const initialScreenshot = await canvas.screenshot();

      await page.locator('#textInput').fill('Hello World');
      await page.locator('#addTextBtn').click();

      await page.waitForTimeout(1000); // Add a small delay for mobile

      await expect(async () => {
        expect(await canvas.screenshot()).not.toEqual(initialScreenshot);
      }).toPass({ timeout: 10000 });
    });
  });
});
