export async function mockAPIs(page) {
  await page.route('**/api/csrf-token', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'test-csrf-token' }) });
  });
  await page.route('**/api/pricing-info', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      pricePerSquareInchCents: 15,
      resolutions: [{ id: 'dpi_300', name: '300 DPI', ppi: 300, costMultiplier: 1.3 }],
      materials: [{ id: 'pp_standard', name: 'Standard PP', costMultiplier: 1.0 }],
      complexity: { tiers: [{ thresholdInches: 12, multiplier: 1.0 }] },
      quantityDiscounts: [{ quantity: 1, discount: 0.0 }],
    })});
  });
  await page.route('**/api/auth/issue-temp-token', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, token: 'test-auth-token' }) });
  });
  await page.route('**/api/upload-design', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, designImagePath: '/uploads/test.png' }) });
  });
  await page.route('**/api/create-order', route => {
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, order: { orderId: 'test-order-123' } }) });
  });
  await page.route('**/api/auth/magic-login', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Magic link sent! Please check your email.' }),
    });
  });
  await page.route('**/api/orders', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          orderId: 'test-order-123',
          receivedAt: new Date().toISOString(),
          status: 'NEW',
          designImagePath: '/verification/test.png',
          orderDetails: { quantity: 50 },
          billingContact: { givenName: 'Test', familyName: 'User' },
        },
      ]),
    });
  });
  await page.route('**/api/orders/test-order-123/status', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, order: { status: 'ACCEPTED' } }),
    });
  });
}
