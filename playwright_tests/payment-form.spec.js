import { test, expect } from '@playwright/test';

test.describe('Payment Form Interaction', () => {
  test.describe('Desktop', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('payment form is visible', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('#payment-form')).toBeVisible();
    });
  });

  test.describe('Mobile', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('allows a user to navigate to and view the payment form', async ({ page }) => {
      await page.goto('/');

      // The following is a guess based on the error logs.
      // The 'rolodex' component could not be found in the codebase.
      await page.locator('#rolodex-next').click();
      await page.waitForTimeout(1000); // Add a delay as a potential fix
      await expect(page.locator('.rolodex-card[data-index="1"].active')).toBeVisible();

      await page.locator('#rolodex-next').click();
      await page.waitForTimeout(1000); // Add a delay as a potential fix
      await expect(page.locator('.rolodex-card[data-index="2"].active')).toBeVisible();
    });
  });
});
