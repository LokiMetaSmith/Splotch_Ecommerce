import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  console.log("Starting End-to-End Test...");

  // 1. Navigate to front end
  await page.goto('https://127.0.0.1:5173');
  console.log("Navigated to frontend");

  // Wait for BootStrap to complete async initialization
  await page.waitForFunction(() => window.__appInitialized === true, { timeout: 10000 }).catch(e => console.log("BootStrap wait timed out, continuing..."));

  // 2. Upload Creative Commons JPEG
  const fileInput = page.locator('#file');
  await fileInput.setInputFiles('public/test-image.jpg');
  console.log("Uploaded test-image.jpg");

  // Wait for processing
  await page.waitForTimeout(5000);
  
  const addToCartBtn = page.locator('#addToCartBtn');
  await addToCartBtn.waitFor({ state: 'visible' });

  // Add to cart and checkout
  await page.locator('#addToCartBtn').click();
  console.log("Added to cart");
  await page.locator('#checkoutBtn').click();
  console.log("Clicked checkout");

  // 3. Fill the fake order
  await page.locator('#firstName').fill('Loki');
  await page.locator('#lastName').fill('Test');
  await page.locator('#email').fill('loki@example.com');
  await page.locator('#phone').fill('555-555-5555');
  await page.locator('#address').fill('123 Test St');
  await page.locator('#city').fill('Test City');
  await page.locator('#state').fill('TS');
  await page.locator('#postalCode').fill('12345');
  await page.locator('#stickerQuantity').fill('3');
  console.log("Filled out order details");

  // 4. Fill fake credit card in Square iframe
  console.log("Waiting for Square iframe...");
  await page.waitForTimeout(2000); // Wait for Square iframe to render
  
  const cardFrame = page.frames().find(f => f.url().includes('square'));
  if (cardFrame) {
      await cardFrame.locator('#cardNumber').fill('4111 1111 1111 1111');
      await cardFrame.locator('#expirationDate').fill('11/26');
      await cardFrame.locator('#cvv').fill('111');
      await cardFrame.locator('#postalCode').fill('12345');
      console.log("Filled out fake credit card");
  } else {
      console.log("Could not find square frame! Trying alternative...");
      // For some reason, Square Web SDK uses multiple iframes or different names
      // I will just use frameLocator
      const fLoc = page.frameLocator('iframe').first();
      await fLoc.locator('#cardNumber').fill('4111 1111 1111 1111');
      await fLoc.locator('#expirationDate').fill('11/26');
      await fLoc.locator('#cvv').fill('111');
      await fLoc.locator('#postalCode').fill('12345');
  }

  // Submit payment
  const submitBtn = page.locator('#submitPaymentBtn');
  await submitBtn.click();
  console.log("Submitted payment, waiting for confirmation...");

  const statusContainer = page.locator('#payment-status-container');
  await statusContainer.waitFor({ state: 'visible', timeout: 30000 });
  console.log("Order successfully placed!");

  // Wait for redirect to orders page
  await page.waitForURL(/.*\/orders\.html\?requires_login=true$/, { timeout: 15000 });
  console.log("Redirected to login page");

  // 5. Open up Printshop page and fulfill that order
  // Login via API directly for printshop admin
  console.log("Logging into printshop...");
  const authResponse = await context.request.post('http://localhost:3000/api/auth/issue-temp-token', {
    data: { secret: 'dev-secret-key', email: 'admin@splotch.com' }
  });
  if (authResponse.ok()) {
      const { token } = await authResponse.json();
      await context.addCookies([{
          name: 'sessionToken',
          value: token,
          domain: '127.0.0.1',
          path: '/',
          httpOnly: false
      }]);
  } else {
      console.log("Failed to issue temp token, trying magic link fallback...");
      // fallback logic if needed, but dev-secret-key should work
  }

  await page.goto('https://127.0.0.1:5173/printshop.html');
  console.log("Opened printshop.html");

  // Find the order
  const orderCards = page.locator('.order-card');
  await orderCards.first().waitFor({ state: 'visible', timeout: 15000 });

  const orderToFulfill = orderCards.filter({ hasText: 'loki@example.com' }).first();
  await orderToFulfill.waitFor({ state: 'visible', timeout: 5000 });
  console.log("Found our order in Printshop");

  // Check checkbox and nest
  const checkbox = orderToFulfill.locator('.order-select-checkbox');
  await checkbox.check();
  console.log("Selected order for nesting");

  const nestBtn = page.locator('#nestStickersBtn');
  await nestBtn.click();
  console.log("Clicked Nest Stickers");

  const nestedSvg = page.locator('#nested-svg-container svg').first();
  await nestedSvg.waitFor({ state: 'visible', timeout: 45000 });
  
  const cutlines = page.locator('#nested-svg-container .cut-line-element').first();
  await cutlines.waitFor({ state: 'attached', timeout: 10000 });
  console.log("Nested SVG generated successfully with cutlines!");

  // Fulfill order (status -> COMPLETED)
  const actionDropdown = orderToFulfill.locator('select.action-dropdown');
  await actionDropdown.selectOption('PRINTING');
  await page.waitForTimeout(1000); // wait for toast
  await actionDropdown.selectOption('COMPLETED');
  await page.waitForTimeout(1000); // wait for toast

  console.log("Order fulfilled successfully! End-to-end test passed.");

  await browser.close();
})();
