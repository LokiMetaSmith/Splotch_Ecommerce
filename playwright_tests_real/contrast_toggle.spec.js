import { test, expect } from './test-setup.js';

test('Verify canvas contrast toggle buttons change background color and image', async ({ page }) => {
  await page.goto('/');

  const canvas = page.locator('#imageCanvas');
  const bgLightBtn = page.locator('#bgLightBtn');
  const bgDarkBtn = page.locator('#bgDarkBtn');
  const bgMagentaBtn = page.locator('#bgMagentaBtn');
  const bgTransBtn = page.locator('#bgTransBtn');

  // Initial state should have checkerboard background image
  const initialBgImage = await canvas.evaluate(el => window.getComputedStyle(el).backgroundImage);
  expect(initialBgImage).toContain('gradient');

  // 1. Click Dark button
  await bgDarkBtn.click();
  const darkBgColor = await canvas.evaluate(el => window.getComputedStyle(el).backgroundColor);
  const darkBgImage = await canvas.evaluate(el => window.getComputedStyle(el).backgroundImage);
  expect(darkBgColor).toBe('rgb(31, 41, 55)'); // #1f2937
  expect(darkBgImage).toBe('none');

  // 2. Click Magenta button
  await bgMagentaBtn.click();
  const magentaBgColor = await canvas.evaluate(el => window.getComputedStyle(el).backgroundColor);
  const magentaBgImage = await canvas.evaluate(el => window.getComputedStyle(el).backgroundImage);
  expect(magentaBgColor).toBe('rgb(255, 0, 255)'); // #ff00ff
  expect(magentaBgImage).toBe('none');

  // 3. Click Light button
  await bgLightBtn.click();
  const lightBgColor = await canvas.evaluate(el => window.getComputedStyle(el).backgroundColor);
  const lightBgImage = await canvas.evaluate(el => window.getComputedStyle(el).backgroundImage);
  expect(lightBgColor).toBe('rgb(255, 255, 255)'); // white
  expect(lightBgImage).toBe('none');

  // 4. Click Checkered button
  await bgTransBtn.click();
  const transBgImage = await canvas.evaluate(el => window.getComputedStyle(el).backgroundImage);
  expect(transBgImage).toContain('gradient');
});

test('when design is loaded and magenta is selected, canvas background is not occluded by opaque white', async ({ page }) => {
  await page.goto('/');

  // Upload mascot image
  const testImagePath = 'public/mascot.png';
  await page.setInputFiles('#file', testImagePath);
  await expect(page.locator('.message-content').last()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(3000);

  // Click Magenta button
  const bgMagentaBtn = page.locator('#bgMagentaBtn');
  await bgMagentaBtn.click();

  // Inspect the 2D canvas context at the top-left background padding area
  const cornerPixel = await page.evaluate(() => {
    const canvas = document.getElementById('imageCanvas');
    const ctx = canvas.getContext('2d');
    // Sample (10, 10) in the padding area outside the sticker
    const imgData = ctx.getImageData(10, 10, 1, 1).data;
    return { r: imgData[0], g: imgData[1], b: imgData[2], a: imgData[3] };
  });

  console.log('Sampled corner pixel:', cornerPixel);

  // The background outside stickers must NOT be opaque white (which hides the magenta CSS background)
  const isOpaqueWhite = cornerPixel.a === 255 && cornerPixel.r === 255 && cornerPixel.g === 255 && cornerPixel.b === 255;
  expect(isOpaqueWhite).toBe(false);
  // It should be transparent (a === 0) so the CSS background (Magenta #ff00ff) shows through
  expect(cornerPixel.a).toBe(0);
});

