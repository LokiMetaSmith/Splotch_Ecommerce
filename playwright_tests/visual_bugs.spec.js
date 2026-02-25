import { test, expect } from './test-setup.js';

test.describe('Visual Bug Reproduction', () => {
  test('Top menu bar should not overlap with main title', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Wait for elements
    const menuBar = page.locator('.top-menu-bar');
    const mainTitle = page.locator('h1').filter({ hasText: 'Custom Sticker Editor & Secure Pay' });

    await expect(menuBar).toBeVisible();
    await expect(mainTitle).toBeVisible();

    const menuBox = await menuBar.boundingBox();
    const titleBox = await mainTitle.boundingBox();

    // Check for overlap
    const isOverlapping = !(
      menuBox.y + menuBox.height <= titleBox.y ||
      menuBox.y >= titleBox.y + titleBox.height ||
      menuBox.x + menuBox.width <= titleBox.x ||
      menuBox.x >= titleBox.x + titleBox.width
    );

    expect(isOverlapping, `Top menu bar overlaps with main title. Menu: ${JSON.stringify(menuBox)}, Title: ${JSON.stringify(titleBox)}`).toBeFalsy();
  });

  test('Set max dimension label should not be squashed', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    const label = page.locator('#standard-sizes-controls span').filter({ hasText: 'Set max dimension to:' });
    await expect(label).toBeVisible();

    const labelBox = await label.boundingBox();

    // In the bug, the text is squashed. Let's assume a reasonable width for this text should be at least 100px
    // (approx 20 chars * 5px/char, typically closer to 150px).
    // If it's wrapping heavily, the width might be small.
    // Or we can check the height. If it wraps 3 lines, height will be > 40px (assuming 16px line height).

    console.log(`Label width: ${labelBox.width}, height: ${labelBox.height}`);

    // Failing condition: Label is too narrow or too tall (indicating bad wrapping)
    const isSquashed = labelBox.width < 120 || labelBox.height > 30;

    expect(isSquashed, `Label "Set max dimension to:" appears to be squashed or wrapping excessively. Width: ${labelBox.width}, Height: ${labelBox.height}`).toBeFalsy();
  });
});
