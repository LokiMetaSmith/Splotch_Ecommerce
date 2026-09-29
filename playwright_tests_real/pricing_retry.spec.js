import { test, expect } from '../playwright_tests/test-setup.js';

test.describe('Pricing Info Fetch Retry & Resilience', () => {
  test('retries transient failures and successfully loads pricing config', async ({ page }) => {
    let callCount = 0;

    // Intercept /api/pricing-info
    await page.route('**/api/pricing-info*', async (route) => {
      callCount++;
      if (callCount <= 2) {
        // First 2 calls fail with 500
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Transient Database Error' }),
        });
      } else {
        // 3rd call succeeds with valid pricing config
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            pricePerSquareInchCents: 11,
            resolutions: [{ id: 'dpi_300', name: 'Standard (300 DPI)', ppi: 300 }],
            materials: [{ id: 'pp_standard', name: 'PP Standard', supportedLayers: ['base', 'cutline'] }],
            layers: [{ id: 'base', name: 'Base Design', priceCents: 0, required: true }],
            complexity: { tiers: [] }
          }),
        });
      }
    });

    await page.goto('/');

    // Wait for the material select to have options loaded
    const materialSelect = page.locator('#stickerMaterial');
    await expect(materialSelect.locator('option')).toHaveCount(1, { timeout: 15000 });
    await expect(materialSelect.locator('option')).toHaveText('Standard Weatherproof Film');

    // Confirm that it retried at least twice before succeeding
    expect(callCount).toBeGreaterThanOrEqual(3);

    // Confirm error status message was NOT displayed
    const paymentStatus = page.locator('#payment-status-container');
    const isVisible = await paymentStatus.isVisible().catch(() => false);
    if (isVisible) {
      await expect(paymentStatus).not.toContainText('Could not load pricing information');
    }
  });

  test('displays error status if all retries are exhausted', async ({ page, isMobile }) => {
    // Intercept /api/pricing-info and fail all requests
    await page.route('**/api/pricing-info*', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Service Unavailable' }),
      });
    });

    await page.goto('/');

    if (isMobile) {
      const specsTab = page.locator('button[data-tab="specs"]');
      await specsTab.click();
    }

    // Verify error notification is displayed
    const paymentStatus = page.locator('#payment-status-container');
    await expect(paymentStatus).toBeVisible({ timeout: 15000 });
    await expect(paymentStatus).toContainText('Could not load pricing information. Please refresh.');
  });
});
