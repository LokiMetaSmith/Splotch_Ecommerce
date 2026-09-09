import { test, expect } from '../playwright_tests/test-setup.js';
import path from 'path';

test.describe('Non-overlapping UI and Bleed Margin Default', () => {
  const testImagePath = path.join(process.cwd(), 'public', 'mascot.png');

  test('contrast buttons are above canvas, legend is below canvas, margin defaults to 0', async ({ page }) => {
    await page.goto('/');

    const canvas = page.locator('#imageCanvas');
    const bgLightBtn = page.locator('#bgLightBtn');
    const boundaryMarginInput = page.locator('#boundaryMarginInput');
    const boundaryMarginSlider = page.locator('#boundaryMarginSlider');

    // 1. Check default margin values
    await expect(boundaryMarginInput).toHaveValue('0');
    await expect(boundaryMarginSlider).toHaveValue('0');

    // 2. Check contrast buttons are strictly above the canvas
    const initialCanvasBox = await canvas.boundingBox();
    const btnBox = await bgLightBtn.boundingBox();
    expect(initialCanvasBox).not.toBeNull();
    expect(btnBox).not.toBeNull();
    expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(initialCanvasBox.y);

    // 3. Upload image
    await page.setInputFiles('#file', testImagePath);
    await expect(page.locator('.message-content').last()).toBeVisible({ timeout: 10000 });

    // Wait for cutline and legend to update
    const legend = page.locator('#cutline-legend');
    await expect(legend).toBeVisible({ timeout: 10000 });

    // 4. Check legend is strictly below the canvas using fresh bounding box
    const currentCanvasBox = await canvas.boundingBox();
    const legendBox = await legend.boundingBox();
    expect(currentCanvasBox).not.toBeNull();
    expect(legendBox).not.toBeNull();
    expect(legendBox.y).toBeGreaterThanOrEqual(currentCanvasBox.y + currentCanvasBox.height);
  });
});
