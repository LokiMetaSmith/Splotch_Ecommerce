import { test, expect } from '@playwright/test';

test.describe('Add Text to Image', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should add text to an image on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForLoadState('networkidle');

    // Upload an image
    await page.locator('input[type="file"]').first().setInputFiles('verification/test.png');

    // Add text
    await page.locator('#textInput').fill('Hello, Splotch!');
    await page.locator('#addTextBtn').click();

    // Verify by taking a screenshot
    await expect(page.locator('#imageCanvas')).toHaveScreenshot('add-text-canvas-desktop.png');
  });

  test('should add text to an image on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForLoadState('networkidle');

    // In mobile, file input is on the first rolodex card.
    await page.locator('#mobile-file').setInputFiles('verification/test.png');

    // Navigate to the customize card
    await page.locator('#rolodex-next').click();
    await expect(page.locator('.rolodex-card[data-index="1"]')).toHaveClass(/active/);

    // Add text
    await page.locator('#mobile-textInput').fill('Hello Mobile');
    await page.locator('#mobile-addTextBtn').click();

    // Verify by taking a screenshot of the thumbnail
    await expect(page.locator('#thumbnail-canvas')).toHaveScreenshot('add-text-canvas-mobile.png');
  });
});
