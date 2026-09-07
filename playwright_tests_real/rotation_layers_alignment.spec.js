import { test, expect } from './test-setup.js';

test('verify layers alignment and dimensions consistency on rotation', async ({ page }) => {
  await page.goto('/');

  // Generate a non-square image with transparent background (100x100 canvas with a 60x60 circle at center)
  const testImage = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'blue';
    ctx.beginPath();
    ctx.arc(50, 50, 30, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL('image/png');
  });

  const buffer = Buffer.from(testImage.split(',')[1], 'base64');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.waitForSelector('input[type="file"]');
  await page.locator('label[for="file"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'circle-test.png',
    mimeType: 'image/png',
    buffer: buffer,
  });

  // Wait for processing to complete
  await expect(page.locator('#rotateLeftBtn')).toBeEnabled({ timeout: 10000 });
  await expect(page.locator('#canvas-loading-overlay')).toHaveClass(/opacity-0/, { timeout: 15000 });

  const widthInput = page.locator('#widthInput');
  const heightInput = page.locator('#heightInput');
  const resizeSlider = page.locator('#resizeSlider');

  // Wait for dimensions to settle
  await expect(async () => {
    const w = await widthInput.inputValue();
    expect(parseFloat(w)).toBeGreaterThan(0);
  }).toPass();
  await page.waitForTimeout(500);

  const initialW = await widthInput.inputValue();
  const initialH = await heightInput.inputValue();
  const initialSlider = await resizeSlider.inputValue();

  expect(parseFloat(initialSlider)).toBe(2);

  // Rotate Right by 90 degrees
  const rotateRightBtn = page.locator('#rotateRightBtn');
  await rotateRightBtn.click();

  // Wait for canvas to re-render
  await page.waitForTimeout(500);

  const rotatedW = await widthInput.inputValue();
  const rotatedH = await heightInput.inputValue();
  const rotatedSlider = await resizeSlider.inputValue();

  // Dimensions should swap (or stay equal if square)
  expect(parseFloat(rotatedW)).toBeCloseTo(parseFloat(initialH), 1);
  expect(parseFloat(rotatedH)).toBeCloseTo(parseFloat(initialW), 1);

  // Slider should still be 2.0 and NOT explode to canvas size
  expect(parseFloat(rotatedSlider)).toBe(2);
});
