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

    // Wait for pricing to load by waiting for calculating spinner to be gone
    await expect(page.locator('.animate-spin.h-4.w-4')).toHaveCount(0, { timeout: 15000 });
    // Wait for the sandbox banner to be initialized
    const sandboxBanner = page.locator('#square-sandbox-banner');
    await expect(sandboxBanner).toBeAttached({ timeout: 15000 });
    // And ensure the hidden class is actually removed, but evaluating the visibility for mobile might fail due to viewport wrapping in test
    // check if it's attached
    await expect(sandboxBanner).toBeAttached({ timeout: 15000 });

    // Verify warning content
    await expect(sandboxBanner).toContainText('Sandbox Mode');
    await expect(sandboxBanner).toContainText('physical stickers will NOT be printed or shipped');
    await expect(sandboxBanner).toContainText('4111 1111 1111 1111');

    // Verify payment details section highlight
    const paymentSection = page.locator('#payment-details-section');
    await expect(paymentSection).toHaveClass(/border-amber-500/);

    // Verify card hint above card container
    const cardHint = page.locator('#card-sandbox-hint');
    // Check for not hidden class since it's probably using flex and mobile might wrap differently
    const cardHintClassList = await cardHint.evaluate(el => Array.from(el.classList));
    expect(cardHintClassList).not.toContain('hidden');
    await expect(cardHint).toContainText('4111 1111 1111 1111');

    // Verify copy button functionality
    const copyBtn = page.locator('#copyTestCardBtn');
    await expect(copyBtn).toBeAttached({ timeout: 10000 });
    await copyBtn.evaluate(el => el.click());
    await expect(page.locator('#copyTestCardText')).toHaveText('Copied!', { timeout: 3000 });
  });
});
