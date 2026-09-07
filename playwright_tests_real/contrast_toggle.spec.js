import { test, expect } from '@playwright/test';

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
