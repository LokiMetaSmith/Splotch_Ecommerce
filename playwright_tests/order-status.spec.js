import { test, expect } from './test-setup.js';

test('has title', async ({ page }) => {
  await page.goto('/printshop.html');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Print Shop - Order Dashboard/);
});
