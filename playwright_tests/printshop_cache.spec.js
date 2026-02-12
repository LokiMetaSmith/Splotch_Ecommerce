import { test, expect } from './test-setup.js';

test('printshop caches SVG fetches during nesting', async ({ page }) => {
    // 1. Mock Orders
    await page.route('**/api/orders', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
            {
                orderId: '12345678',
                receivedAt: new Date().toISOString(),
                status: 'NEW',
                designImagePath: '/uploads/design.svg',
                cutLinePath: '/uploads/cut.svg',
                billingContact: { givenName: 'Test', familyName: 'User' }
            }
        ])
    }));

    // 2. Mock SVG Design
    let fetchCount = 0;
    await page.route('**/uploads/cut.svg', route => {
        fetchCount++;
        return route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>'
        });
    });

    // 3. Login
    await page.addInitScript(() => {
        localStorage.setItem('authToken', 'mock-token');
    });

    // 4. Go to Printshop
    await page.goto('/printshop.html');

    // 5. Wait for orders to load
    await expect(page.locator('#order-card-12345678')).toBeVisible();

    // 6. Click Nest Stickers
    // Wait for the button to be stable
    const nestBtn = page.locator('#nestStickersBtn');
    await expect(nestBtn).toBeVisible();
    await nestBtn.click();

    // Wait for success toast
    await expect(page.locator('#success-toast')).toContainText('Nesting complete.');

    // 7. Click Nest Stickers again
    // Wait for toast to hide or disappear to avoid click interception, or just wait a bit.
    // The toast hides after 3s (setTimeout(hideSuccessToast, 3000)).
    // But we can just wait for the button to be clickable again if it was disabled (it wasn't in the code).
    // Let's force wait for the toast to go away or manually hide it via JS?
    // Waiting 3.5s is safe.
    await page.waitForTimeout(3500);

    await nestBtn.click();
    await expect(page.locator('#success-toast')).toContainText('Nesting complete.');

    // 8. Verify fetch count
    // Before optimization: should be 2
    // After optimization: should be 1
    // We expect 1 effectively, so this test will FAIL until I optimize.
    expect(fetchCount).toBe(1);
});
