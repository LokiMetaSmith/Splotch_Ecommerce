import { test, expect } from '@playwright/test';

test('Verify UX icons and required attribute in orders.html', async ({ page }) => {
  // Navigate to the orders page
  await page.goto('/orders.html');

  // Verify email input has the required attribute
  const emailInput = page.locator('#emailInput');
  await expect(emailInput).toHaveAttribute('required', '');

  // Verify Login Button has an SVG icon
  // The button text is "Send Magic Link", but we check for SVG inside it
  const loginBtnSvg = page.locator('#loginBtn svg');
  await expect(loginBtnSvg).toHaveCount(1);

  // Verify Export Data Button has an SVG icon
  // Note: These buttons might be inside a hidden section, but we check presence in DOM
  const exportBtnSvg = page.locator('#exportDataBtn svg');
  await expect(exportBtnSvg).toHaveCount(1);

  // Verify Delete Account Button has an SVG icon
  const deleteBtnSvg = page.locator('#deleteAccountBtn svg');
  await expect(deleteBtnSvg).toHaveCount(1);
});
