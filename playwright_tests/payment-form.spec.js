import { test, expect } from '@playwright/test';

test.describe('Payment Form Interaction', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Desktop: payment form is visible and interactive', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#desktop-layout')).toBeVisible();
    await expect(page.locator('#firstName')).toBeVisible();
    await expect(page.locator('#address')).toBeVisible();
    await expect(page.locator('#card-container')).toBeVisible();
    const submitButton = page.locator('form#payment-form button[type="submit"]');
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();
  });

  test('Mobile: allows a user to navigate to and view the payment form', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#mobile-layout')).toBeVisible();

    // Navigate to the payment form
    await page.locator('#rolodex-next').click();
    await page.locator('#rolodex-next').click();
    await expect(page.locator('.rolodex-card[data-index="2"]')).toHaveClass(/active/);

    // Check for form fields
    await expect(page.locator('#mobile-shippingAddress')).toBeVisible();
    await expect(page.locator('#mobile-card-container')).toBeVisible();
    await expect(page.locator('form#mobile-payment-form button[type="submit"]')).toBeVisible();
  });
});
