import { test, expect } from './test-setup.js';

test('orders list renders correctly and reorder button works', async ({ page }) => {
  // Mock API response
  await page.route('**/api/orders/my-orders', async route => {
    const json = [
      {
        orderId: '12345678-abcd-1234-abcd-1234567890ab',
        receivedAt: '2023-10-27T10:00:00Z',
        amount: 1500,
        status: 'DELIVERED',
        designImagePath: '/uploads/test-design.png'
      },
       {
        orderId: '87654321-dcba-4321-dcba-ba0987654321',
        receivedAt: '2023-10-26T10:00:00Z',
        amount: 2000,
        status: 'PRINTING',
        designImagePath: '/uploads/test-design-2.png'
      }
    ];
    await route.fulfill({ json });
  });

  // Navigate to orders page with a mock token
  await page.goto('/orders.html?token=test-token');

  // Check if orders are displayed
  const ordersList = page.locator('#orders-list');
  await expect(ordersList.locator('.order-card')).toHaveCount(2);

  // Verify content of the first order
  const firstOrder = ordersList.locator('.order-card').first();
  await expect(firstOrder).toContainText('Order ID: 12345678...');
  await expect(firstOrder).toContainText('$15.00');
  await expect(firstOrder).toContainText('DELIVERED');

  // Verify reorder functionality
  // We need to wait for navigation or URL change
  // Note: The reorder button redirects to /?design=...
  // Since we are running in a test environment, the base URL might be localhost:3000

  const reorderBtn = firstOrder.locator('.reorder-btn');
  await reorderBtn.click();

  // Wait for URL to contain the design parameter
  await page.waitForURL(/\/\?design=%2Fuploads%2Ftest-design\.png/);
});
