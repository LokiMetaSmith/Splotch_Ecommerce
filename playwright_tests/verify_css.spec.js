
import { test, expect } from '@playwright/test';

test('Verify Splotch Theme and Tailwind CSS are applied', async ({ page }) => {
  await page.goto('/');

  // 1. Verify Splotch Theme is loading (this seemed to work before)
  const body = page.locator('body');
  await expect(body).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  // 2. Verify Tailwind CSS is loading
  // We check the header container which has "flex justify-between items-center mb-6"
  // If Tailwind works, it should be display: flex.
  const headerContainer = page.locator('main.container > div').first();
  // Using .first() because main.container has children. The first child is the header div with flex.
  // <div class="flex justify-between items-center mb-6">

  // To be safe, let's target it more specifically.
  // It contains the H1.
  const headerDiv = page.locator('div:has(h1)');

  await expect(headerDiv).toHaveCSS('display', 'flex');
  await expect(headerDiv).toHaveCSS('justify-content', 'space-between');
  await expect(headerDiv).toHaveCSS('align-items', 'center');

  // Verify another Tailwind class: 'hidden'
  // <div id="productLinkContainer" class="mt-4 hidden">
  const hiddenDiv = page.locator('#productLinkContainer');
  await expect(hiddenDiv).toHaveCSS('display', 'none');
});
