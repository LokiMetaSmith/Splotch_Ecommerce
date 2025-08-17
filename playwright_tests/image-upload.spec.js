import { test, expect } from '@playwright/test';

test('allows a user to upload an image', async ({ page }) => {
  // Mock the CSRF token endpoint
  await page.route('**/api/csrf-token', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
    });
  });

  // Mock the pricing info endpoint
  await page.route('**/api/pricing-info', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        pricePerSquareInchCents: 15,
        resolutions: [{ id: 'dpi_300', name: '300 DPI', ppi: 300, costMultiplier: 1.3 }],
        materials: [{ id: 'pp_standard', name: 'Standard PP', costMultiplier: 1.0 }],
        complexity: { tiers: [{ thresholdInches: 12, multiplier: 1.0 }] },
        quantityDiscounts: [{ quantity: 1, discount: 0.0 }],
      }),
    });
  });

  await page.goto('http://localhost:5173');

  // Use the file chooser to upload the test image.
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('label[for="file"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('verification/test.png');

  await page.pause();

  // Wait for the image to be loaded onto the canvas.
  await page.waitForSelector('#payment-status-container:has-text("Image loaded successfully.")');

  // Take a screenshot of the canvas to verify the image is displayed.
  await expect(page.locator('#imageCanvas')).screenshot();
});
