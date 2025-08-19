import { test, expect } from './test-setup.js';

test('allows a user to navigate to the payment form', async ({ page }) => {
  await page.goto('/');

  // --- Step 1: Navigate to the payment form card ---
  // Click "Next" twice to get to the third card (index 2)
  await page.locator('#rolodex-next').click();
  await page.locator('#rolodex-next').click();

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
