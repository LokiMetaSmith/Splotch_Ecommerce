import { test, expect } from './test-setup.js';

test('magic link login form', async ({ page }) => {
  await page.goto('/orders.html');

  // Fill out the email and click the button.
  await page.locator('#emailInput').fill('test@example.com');
  await page.locator('#loginBtn').click();

  // Verify that the success message is displayed.
  await expect(page.locator('#login-status')).toContainText('Magic link sent! Please check your email.');
});
