import { test, expect } from './test-setup.js';

test.use({ deviceScaleFactor: 2 });

test('verify rotation behavior with DPR=2', async ({ page }) => {
  await page.goto('/');

  // Generate a non-square image 300x200
  const nonSquareImage = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 300, 200);
    return canvas.toDataURL('image/png');
  });

  const buffer = Buffer.from(nonSquareImage.split(',')[1], 'base64');

  const fileChooserPromise = page.waitForEvent('filechooser');
  // Wait for input to be present before clicking label
  await page.waitForSelector('input[type="file"]');
  await page.locator('label[for="file"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'test-image.png',
    mimeType: 'image/png',
    buffer: buffer,
  });

  // Wait for processing
  const rotateLeftBtn = page.locator('#rotateLeftBtn');
  await expect(rotateLeftBtn).toBeEnabled({ timeout: 10000 });

  // Get initial canvas size
  const canvas = page.locator('#imageCanvas');

  // Wait for canvas to settle (checking width is > 0)
  await expect(async () => {
     const w = await canvas.getAttribute('width');
     expect(Number(w)).toBeGreaterThan(0);
  }).toPass();

  const initialWidth = await canvas.getAttribute('width');
  const initialHeight = await canvas.getAttribute('height');
  // Clean up style strings to get numbers (e.g. "600px" -> 600)
  const initialStyleWidth = await canvas.evaluate(el => parseFloat(el.style.width));
  const initialStyleHeight = await canvas.evaluate(el => parseFloat(el.style.height));

  console.log('Initial Physical:', initialWidth, initialHeight);
  console.log('Initial Logical (Style):', initialStyleWidth, initialStyleHeight);

  // Rotate
  await rotateLeftBtn.click();

  // Wait for potential animation/repaint and state update
  // We can wait for the width attribute to change if we expect it to change (swap)
  // Since 300x200 != 200x300, it should change.
  await expect(async () => {
      const currentWidth = await canvas.getAttribute('width');
      expect(currentWidth).not.toBe(initialWidth);
  }).toPass();

  // Get new canvas size
  const newWidth = await canvas.getAttribute('width');
  const newHeight = await canvas.getAttribute('height');
  const newStyleWidth = await canvas.evaluate(el => parseFloat(el.style.width));
  const newStyleHeight = await canvas.evaluate(el => parseFloat(el.style.height));

  console.log('New Physical:', newWidth, newHeight);
  console.log('New Logical (Style):', newStyleWidth, newStyleHeight);

  // Assertions: Dimensions should be swapped exactly
  expect(newWidth).toBe(initialHeight);
  expect(newHeight).toBe(initialWidth);

  // Check logical dimensions (allow small floating point differences if any, though likely exact)
  expect(newStyleWidth).toBeCloseTo(initialStyleHeight, 1);
  expect(newStyleHeight).toBeCloseTo(initialStyleWidth, 1);
});
