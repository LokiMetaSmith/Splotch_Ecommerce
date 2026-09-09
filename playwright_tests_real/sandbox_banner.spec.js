import { test, expect } from '../playwright_tests/test-setup.js';

test.describe('Square Sandbox Payment Warning & Test Card Helper', () => {
  test('displays sandbox banner, card hint, and test card 4111 1111 1111 1111 when sandbox environment is active', async ({ page, context, browserName }) => {
    if (browserName === 'chromium') {
      try {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      } catch (e) {
        // Ignore if unsupported
      }
    }
    await page.goto('/');

    // Wait for the sandbox banner to be initialized
    const sandboxBanner = page.locator('#square-sandbox-banner');
    await expect(sandboxBanner).toBeVisible({ timeout: 10000 });

    // Verify warning content
    await expect(sandboxBanner).toContainText('Sandbox Mode');
    await expect(sandboxBanner).toContainText('physical stickers will NOT be printed or shipped');
    await expect(sandboxBanner).toContainText('4111 1111 1111 1111');

    // Verify payment details section highlight
    const paymentSection = page.locator('#payment-details-section');
    await expect(paymentSection).toHaveClass(/border-amber-500/);

    // Verify card hint above card container
    const cardHint = page.locator('#card-sandbox-hint');
    await expect(cardHint).toBeVisible();
    await expect(cardHint).toContainText('4111 1111 1111 1111');

    // Verify copy button functionality
    const copyBtn = page.locator('#copyTestCardBtn');
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    await expect(page.locator('#copyTestCardText')).toHaveText('Copied!', { timeout: 3000 });
  });
});
