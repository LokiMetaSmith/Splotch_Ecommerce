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
  await page.waitForFunction(() => window.stickers && window.stickers.length > 0 && !!window.stickers[0].image);
  await page.waitForTimeout(1500);

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

test('tick marks and size indicator adapt to dark background with drop shadow and inverse contrast colors', async ({ page }) => {
  await page.goto('/');

  // Upload mascot image
  const testImagePath = 'public/mascot.png';
  await page.setInputFiles('#file', testImagePath);
  await page.waitForFunction(() => window.stickers && window.stickers.length > 0 && !!window.stickers[0].image);
  await page.waitForTimeout(1500);

  // 1. Click Dark button (#bgDarkBtn)
  const bgDarkBtn = page.locator('#bgDarkBtn');
  await bgDarkBtn.click();
  await page.waitForTimeout(500);

  // Verify theme in dark mode
  const darkTheme = await page.evaluate(async () => {
    const canvas = document.getElementById('imageCanvas');
    const ctx = canvas.getContext('2d');
    const { getCanvasTheme } = await import('/src/lib/canvas-utils.js');
    return getCanvasTheme(ctx);
  });

  expect(darkTheme.isDark).toBe(true);
  expect(darkTheme.textColor).toContain('255, 255, 255');
  expect(darkTheme.strokeColor).toContain('255, 255, 255');
  expect(darkTheme.shadowColor).toContain('0, 0, 0');

  // 2. Click Light button (#bgLightBtn)
  const bgLightBtn = page.locator('#bgLightBtn');
  await bgLightBtn.click();
  await page.waitForTimeout(500);

  const lightTheme = await page.evaluate(async () => {
    const canvas = document.getElementById('imageCanvas');
    const ctx = canvas.getContext('2d');
    const { getCanvasTheme } = await import('/src/lib/canvas-utils.js');
    return getCanvasTheme(ctx);
  });

  expect(lightTheme.isDark).toBe(false);
  expect(lightTheme.textColor).toContain('0, 0, 0');
  expect(lightTheme.strokeColor).toContain('0, 0, 0');
  expect(lightTheme.shadowColor).toContain('255, 255, 255');

  // 3. Click Magenta button (#bgMagentaBtn)
  const bgMagentaBtn = page.locator('#bgMagentaBtn');
  await bgMagentaBtn.click();
  await page.waitForTimeout(500);

  const magentaTheme = await page.evaluate(async () => {
    const canvas = document.getElementById('imageCanvas');
    const ctx = canvas.getContext('2d');
    const { getCanvasTheme } = await import('/src/lib/canvas-utils.js');
    return getCanvasTheme(ctx);
  });

  expect(magentaTheme.isDark).toBe(true);
  expect(magentaTheme.textColor).toContain('255, 255, 255');
});

