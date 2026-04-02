import { test, expect } from './test-setup.js';

test.describe('Printshop Dashboard E2E', () => {

  test.beforeEach(async ({ page }) => {
      // Create additional intercepts for printshop specifically.
      // The test-setup.js mocks some stuff, but we need to mock /api/orders, /api/auth/login, etc.

      await page.route('/api/auth/login', async (route) => {
          return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ success: true, token: 'mock-admin-token', user: { username: 'admin', role: 'admin' } }),
              headers: {
                  'Set-Cookie': 'jwt=mock-admin-token; Path=/'
              }
          });
      });

      await page.route('/api/admin/sales-metrics', async (route) => {
          return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                  totalRevenue: 150.50,
                  totalOrders: 10,
                  recentOrders: 2
              })
          });
      });

      await page.route('/api/ping', async (route) => {
          return route.fulfill({
              status: 200,
              contentType: 'text/plain',
              body: 'pong'
          });
      });

      // Initially, mock orders
      await page.route('/api/orders', async (route) => {
          // If it's a GET, return some mock orders
          if (route.request().method() === 'GET') {
             return route.fulfill({
                 status: 200,
                 contentType: 'application/json',
                 body: JSON.stringify([
                     {
                         orderId: 'ORDER-11111',
                         status: 'NEW',
                         amount: 1550, // $15.50
                         receivedAt: new Date().toISOString(),
                         shippingContact: { name: 'Alice Smith', email: 'alice@example.com' },
                         designImagePath: '/placeholder.png'
                     },
                     {
                         orderId: 'ORDER-22222',
                         status: 'PRINTING',
                         amount: 3200, // $32.00
                         receivedAt: new Date(Date.now() - 86400000).toISOString(),
                         shippingContact: { name: 'Bob Jones', email: 'bob@example.com' },
                         designImagePath: '/placeholder.png'
                     }
                 ])
             });
          }
          return route.continue();
      });

      // Handle the status update POST
      await page.route('/api/orders/*/status', async (route) => {
         if (route.request().method() === 'POST') {
             const postData = JSON.parse(route.request().postData() || '{}');
             return route.fulfill({
                 status: 200,
                 contentType: 'application/json',
                 body: JSON.stringify({
                     success: true,
                     message: `Order status updated to ${postData.status}`
                 })
             });
         }
         return route.continue();
      });


      await page.goto('/printshop.html');
  });

  test('should load printshop, display orders, and fulfill order', async ({ page }) => {
    // Now go to the printshop dashboard
    await page.goto('/printshop.html');

    // Attempt Login
    await page.click('#loginBtn');

    // Wait for the login modal to appear
    await page.waitForSelector('#login-modal:not(.hidden)');

    // Fill in credentials
    await page.fill('#username-input', 'admin');
    await page.fill('#password-input', 'adminpass123');

    // Click submit
    await page.click('#password-login-btn');

    // The printshop frontend should refresh orders list upon login success
    // Wait for the "Incoming Orders" list to populate
    await expect(page.locator('#metric-total-orders')).toHaveText('10');

    // Mocking out the frontend checkout flow is too complex for a single dashboard test without a real database.
    // We already mock the order fetch, so we'll just check what the API returned.
    const orderCards = page.locator('.order-card');
    await expect(orderCards).toHaveCount(2);

    // Because orders are reversed on the backend `slice().reverse()`, ORDER-22222 comes first.
    // Check the second order (which should be ORDER-11...) since we truncate display
    const order11111 = orderCards.nth(1);
    await expect(order11111).toContainText('ORDER-11');

    // Update status to PRINTING (Fulfilling order)
    const printButton = order11111.locator('button.action-btn[data-status="PRINTING"]');
    await printButton.click();

    // Wait for success toast
    const successToast = page.locator('#success-toast');
    await expect(successToast).toBeVisible();
    await expect(page.locator('#success-message')).toContainText('Order status updated');
  });
});
