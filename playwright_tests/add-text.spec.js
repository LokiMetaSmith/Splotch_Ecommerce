import { test, expect } from '@playwright/test';

test('allows a user to add text to an image', async ({ page }) => {
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

  // First, upload an image to enable the text editing controls.
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('label[for="file"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('verification/test.png');
  await page.waitForSelector('#payment-status-container:has-text("Image loaded successfully.")');

  // Now, add text.
  await page.locator('#textInput').fill('Hello, World!');
  await page.locator('#addTextBtn').click();

  // Verify that the text was added.
  await page.waitForSelector('#payment-status-container:has-text("Text \\"Hello, World!\\" added.")');

  // Take a screenshot of the canvas to verify the text is displayed.
  await expect(page.locator('#imageCanvas')).screenshot();
});
