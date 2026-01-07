// playwright_tests_real/smoke.spec.js
import { test, expect } from '@playwright/test';

test.describe('Real Backend Smoke Test', () => {

  test('should load the homepage and connect to the real backend', async ({ page }) => {
    // 1. Navigate to the homepage
    await page.goto('/');

    // 2. Verify that the page loads
    await expect(page).toHaveTitle(/Image Editor & Secure Pay/);

    // 3. Verify that the backend is reachable by checking the pricing request
    // The application makes a call to /api/pricing-info on load.
    // We can intercept this to verify it happens, but let the request go through to the real backend.
    const pricingResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/pricing-info') && response.status() === 200
    );

    // Reload to ensure we catch the network request
    await page.reload();

    const pricingResponse = await pricingResponsePromise;
    expect(pricingResponse.ok()).toBeTruthy();

    const pricingData = await pricingResponse.json();
    expect(pricingData).toHaveProperty('pricePerSquareInchCents');
    expect(pricingData).toHaveProperty('resolutions');

    // 4. Verify that the CSRF token is fetched
    const csrfResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/csrf-token') && response.status() === 200
    );
    await page.reload();
    const csrfResponse = await csrfResponsePromise;
    expect(csrfResponse.ok()).toBeTruthy();
    const csrfData = await csrfResponse.json();
    expect(csrfData).toHaveProperty('csrfToken');

    // 5. Check if the server info is fetched (sanity check)
    // Actually server-info is called via fetch
    // Let's verify we can see the text on the page or some state change if applicable.
    // But verifying the network responses is the strongest proof we are talking to the real backend.
  });

});
