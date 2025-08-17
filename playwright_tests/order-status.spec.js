import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('http://localhost:5173/printshop.html');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Print Shop - Order Dashboard/);
});
