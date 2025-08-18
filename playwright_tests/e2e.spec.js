import { test, expect } from './test-setup.js';

test('has title', async ({ page }) => {
  await page.goto('/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Image Editor & Secure Pay - Custom Stickers/);
});
