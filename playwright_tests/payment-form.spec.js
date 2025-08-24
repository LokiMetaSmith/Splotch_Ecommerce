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

  // --- Step 2: Verify the payment form card is active ---
  await expect(page.locator('.rolodex-card[data-index="2"]')).toHaveClass(/active/);

  // --- Step 3: Check that the new form fields are present ---
  await expect(page.locator('#shippingFirstName')).toBeVisible();
  await expect(page.locator('#shippingLastName')).toBeVisible();
  await expect(page.locator('#shippingEmail')).toBeVisible();
  await expect(page.locator('#shippingAddress')).toBeVisible();
  await expect(page.locator('#shippingCity')).toBeVisible();
  await expect(page.locator('#shippingState')).toBeVisible();
  await expect(page.locator('#shippingPostalCode')).toBeVisible();

  // Check for the Square card element container
  await expect(page.locator('#card-container')).toBeVisible();

  // Check for the submit button
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});
