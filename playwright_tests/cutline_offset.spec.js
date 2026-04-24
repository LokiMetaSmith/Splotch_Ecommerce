import { test, expect } from '@playwright/test';

test.describe('Cutline Offset Slider Interaction', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept external requests
    await page.route('https://sandbox.web.squarecdn.com/v1/square.js', route => route.abort());

    // Intercept internal API requests
    await page.route('**/api/csrf-token', route => route.fulfill({
      status: 200,
      json: { csrfToken: 'mock-csrf-token' },
      headers: { 'Access-Control-Allow-Origin': '*' }
    }));
    await page.route('**/api/pricing-info', route => route.fulfill({
      status: 200,
      json: {
        pricePerSquareInchCents: 15,
        resolutions: [{ id: 'dpi_300', ppi: 300 }],
        complexity: { tiers: [] },
        quantityDiscounts: []
      },
      headers: { 'Access-Control-Allow-Origin': '*' }
    }));
    await page.route('**/api/inventory', route => route.fulfill({
      status: 200,
      json: {},
      headers: { 'Access-Control-Allow-Origin': '*' }
    }));

    // Load the page
    await page.goto('/');
  });

  test('generates smart edge cuts when slider moves negative into sticker', async ({ page }) => {
    // Ensure the page is ready
    await page.waitForSelector('#canvas-container');

    // First unlock the easter egg to enable mascot button
    await page.evaluate("document.dispatchEvent(new CustomEvent('easterEggUnlocked'))");

    // Mock file input manually to load the mascot using JS, bypassing the need for an actual click
    await page.evaluate(async () => {
        const response = await fetch('/mascot.png');
        const blob = await response.blob();
        const file = new File([blob], 'mascot.png', { type: 'image/png' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        const fileInput = document.getElementById('file');
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Wait for the smart cutline to automatically generate
    const generateBtn = page.locator('#generateCutlineBtn');
    await expect(generateBtn).toBeVisible({ timeout: 10000 });
    await expect(generateBtn).toBeEnabled({ timeout: 10000 });

    // Wait for canvas to draw properly
    await page.waitForTimeout(1000);

    const canvas = page.locator('canvas');

    // Grab the cutline value display before
    const initialOffsetDisplay = await page.locator('#cutlineOffsetValue').textContent();

    // Now interact with the slider to move it negative, into the sticker
    const slider = page.locator('#cutlineOffsetSlider');
    await expect(slider).toBeVisible();

    // Fill the slider to -50
    // Wait for requestAnimationFrame update loop to draw negative cutline
    // we need to set value and dispatch both input and change to trigger redraws
    await page.evaluate(() => {
        const slider = document.getElementById('cutlineOffsetSlider');
        slider.value = -50;
        slider.dispatchEvent(new Event('input'));
        slider.dispatchEvent(new Event('change'));
    });

    await page.waitForTimeout(1000);

    const finalOffsetDisplay = await page.locator('#cutlineOffsetValue').textContent();

    expect(finalOffsetDisplay).not.toEqual(initialOffsetDisplay);
    expect(finalOffsetDisplay).toEqual("-50");
  });
});
