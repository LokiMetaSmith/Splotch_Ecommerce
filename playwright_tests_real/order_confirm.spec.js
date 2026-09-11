import { test, expect } from '@playwright/test';

test.describe('Order Confirmation and Summary', () => {
  test('should disable pay button until checkbox is checked', async ({ page }) => {
    // Navigate to local dev server or index.html
    await page.goto('/'); 

    // Wait for main elements to load
    await expect(page.locator('#submitPaymentBtn')).toBeVisible();

    // Checkbox and Pay button
    const payBtn = page.locator('#submitPaymentBtn');
    const confirmCheck = page.locator('#order-ready-confirm');

    // Button should be disabled initially
    await expect(payBtn).toBeDisabled();

    // Check the box
    await confirmCheck.check();

    // Button should be enabled
    await expect(payBtn).toBeEnabled();

    // Uncheck the box
    await confirmCheck.uncheck();

    // Button should be disabled again
    await expect(payBtn).toBeDisabled();
  });
});
