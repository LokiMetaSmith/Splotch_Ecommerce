import { test, expect } from '@playwright/test';

test.describe('Data Compliance Flow', () => {
    test('should show cookie banner, privacy section, and allow account deletion', async ({ page, request }) => {
        // 1. Visit Homepage and check Cookie Banner
        await page.goto('/');

        const banner = page.locator('#cookie-consent-banner');
        await expect(banner).toBeVisible();
        await expect(banner).toContainText('We use cookies');

        // Accept cookies
        await banner.getByRole('button', { name: 'Accept' }).click({ force: true });
        await expect(banner).toBeHidden();

        // Reload to ensure banner doesn't reappear
        await page.reload();
        await expect(banner).toBeHidden();

        // 2. Login via Magic Link
        const email = `test-compliance-${Date.now()}@example.com`;
        await page.goto('/orders.html');

        await page.fill('#emailInput', email);
        await page.click('#loginBtn');
        await expect(page.locator('#login-status')).toContainText('Magic link sent');

        // Fetch the token from the server's test endpoint
        const tokenResponse = await request.get(`http://localhost:3000/api/test/last-magic-link?email=${encodeURIComponent(email)}`);
        expect(tokenResponse.ok()).toBeTruthy();
        const { token } = await tokenResponse.json();
        console.log('Retrieved magic link token:', token);

        // Visit the orders page directly with the token
        // (Simulating if the user was redirected or if we unify the pages later)
        await page.goto(`/orders.html?token=${token}`);

        // Wait for orders page verification
        await expect(page.locator('#order-history-section')).toBeVisible();

        // 3. Verify Privacy Section
        const privacySection = page.locator('#data-privacy-section');
        await expect(privacySection).toBeVisible();
        await expect(privacySection).toContainText('Privacy & Data');

        // 4. Test Export Data
        const exportBtn = page.locator('#exportDataBtn');
        const downloadPromise = page.waitForEvent('download');
        await exportBtn.click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe('splotch-user-data.json');

        // Validate downloaded content
        const stream = await download.createReadStream();
        const buffers = [];
        for await (const chunk of stream) {
            buffers.push(chunk);
        }
        const jsonContent = JSON.parse(Buffer.concat(buffers).toString());
        expect(jsonContent.user).toBeDefined();
        expect(jsonContent.user.email).toBe(email);
        expect(jsonContent.orders).toBeDefined();

        // 5. Test Delete Account
        const deleteBtn = page.locator('#deleteAccountBtn');

        // Mock dialog confirm
        page.on('dialog', dialog => dialog.accept());

        await deleteBtn.click();

        // Expect redirect to home (regex to match base URL /)
        await expect(page).toHaveURL(/http:\/\/localhost:\d+\/$/);

        // 6. Verify User Deletion via API
        // We use the same token (which is still valid signature-wise) to try to fetch data
        const dataResponse = await request.get('http://localhost:3000/api/auth/user/data', {
            headers: {
                Authorization: `Bearer ${token}` // Re-use the token we got earlier
            }
        });

        // Should be 404 Not Found because user is deleted from DB
        expect(dataResponse.status()).toBe(404);
    });
});
