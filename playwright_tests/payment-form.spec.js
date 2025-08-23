import { test, expect } from './test-setup.js';

test.describe('Payment Form Interaction', () => {

  test('Mobile: allows a user to navigate to and view the payment form', async ({ page }) => {
    // FIX: Explicitly set a mobile viewport.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    await expect(page.locator('#mobile-layout')).toBeVisible({ timeout: 10000 });

    await page.locator('#rolodex-next').click();
    await expect(page.locator('.rolodex-card[data-index="1"].active')).toBeVisible();
    await page.locator('#rolodex-next').click();
    await expect(page.locator('.rolodex-card[data-index="2"].active')).toBeVisible();

    await expect(page.locator('#mobile-shippingAddress')).toBeVisible();
    await expect(page.locator('#mobile-card-container')).toBeVisible();
    await expect(page.locator('form#mobile-payment-form button[type="submit"]')).toBeVisible();
  });

  test('Desktop: payment form is visible', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    await expect(page.locator('#desktop-layout')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('#firstName')).toBeVisible();
    await expect(page.locator('#address')).toBeVisible();
    await expect(page.locator('#card-container')).toBeVisible();
    const submitButton = page.locator('form#payment-form button[type="submit"]');
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();
  });

});
