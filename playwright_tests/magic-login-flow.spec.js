import { test, expect } from '@playwright/test';

test('magic link login form', async ({ page }) => {
  // Mock the CSRF token endpoint
  await page.route('**/api/csrf-token', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
    });
  });

  // Mock the API response for the magic link request.
  await page.route('**/api/auth/magic-login', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Magic link sent! Please check your email.' }),
    });
  });

  await page.goto('http://localhost:5173/orders.html');

  // Fill out the email and click the button.
  await page.locator('#emailInput').fill('test@example.com');
  await page.locator('#loginBtn').click();

  // Verify that the success message is displayed.
  await expect(page.locator('#login-status')).toContainText('Magic link sent! Please check your email.');
});
