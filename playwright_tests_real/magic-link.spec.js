// playwright_tests_real/magic-link.spec.js
import { test, expect } from '@playwright/test';

test.describe('Real Backend Magic Link Flow', () => {

  test('should allow login via magic link', async ({ page }) => {
    const email = 'test-magic-real@example.com';

    // 1. Navigate to the Order History / Login page
    await page.goto('/orders.html');

    // 2. Fill out the email and request a magic link
    // Ensure the input is visible before interacting
    await expect(page.locator('#emailInput')).toBeVisible();
    await page.locator('#emailInput').fill(email);
    await page.locator('#loginBtn').click();

    // 3. Verify the success message
    await expect(page.locator('#login-status')).toContainText('Magic link sent! Please check your email.');

    // 4. Fetch the token from the test-only endpoint
    // We retry fetching because the server might take a moment to process the request and update the variable,
    // although it should be synchronous in the request handler before response.
    // However, the client receives the response *after* the variable is updated.

    // We make a request to the backend directly from the test runner (node context) or via page.request
    const response = await page.request.get(`/api/test/last-magic-link?email=${encodeURIComponent(email)}`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.token).toBeTruthy();
    const token = data.token;

    console.log('Retrieved magic link token:', token);

    // 5. Navigate to the magic link URL
    await page.goto(`/magic-login.html?token=${token}`);

    // 6. Verify that the user is logged in
    // The magic-login page should hide #login-status and show #order-history upon success
    await expect(page.locator('#login-status')).toHaveClass(/hidden/);
    await expect(page.locator('#order-history')).not.toHaveClass(/hidden/);

    // Optionally, verify that the order history list is visible (even if empty)
    await expect(page.locator('#orders-list')).toBeVisible();
  });

});
