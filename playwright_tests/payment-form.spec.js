import { test, expect } from './test-setup.js';

test('allows a user to submit the payment form', async ({ page }) => {
  await page.goto('/');

  // Check that the form fields are present
  await expect(page.locator('#firstName')).toBeVisible();
  await expect(page.locator('#lastName')).toBeVisible();
  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('#address')).toBeVisible();
  await expect(page.locator('#city')).toBeVisible();
  await expect(page.locator('#state')).toBeVisible();
  await expect(page.locator('#postalCode')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});
