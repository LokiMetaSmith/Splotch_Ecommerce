import { test, expect } from './test-setup.js';

test.describe('Mobile Responsiveness', () => {

  test('Critical elements should be visible on mobile', async ({ page }) => {
    await page.goto('/');

    // Wait for the page to be ready
    await page.waitForLoadState('domcontentloaded');

    const jumpButton = page.locator('nav.top-menu-bar .menu-item').filter({ hasText: 'Jump to Sticker Editor' });
    const orderHistoryButton = page.locator('nav.top-menu-bar .menu-item').filter({ hasText: 'View Order History' });

    // The file input itself might be hidden or styled differently, but let's check it or its label
    const fileInput = page.locator('#file');

    const canvasContainer = page.locator('#canvas-container');
    const editingControls = page.locator('#editing-controls');

    // Payment form is visible initially? Or parts of it?
    // It is in the DOM.
    const paymentForm = page.locator('#payment-form');

    await expect(jumpButton).toBeVisible();
    await expect(orderHistoryButton).toBeVisible();
    await expect(fileInput).toBeVisible();
    await expect(canvasContainer).toBeVisible();
    await expect(editingControls).toBeVisible();
    await expect(paymentForm).toBeVisible();
  });

  test('Navigation buttons should not obscure critical controls', async ({ page, isMobile }) => {
    // Only run this check on mobile viewports
    // isMobile is true for mobile projects configured in playwright.config.js
    if (!isMobile) test.skip();

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const jumpButton = page.locator('nav.top-menu-bar .menu-item').filter({ hasText: 'Jump to Sticker Editor' });
    const fileInput = page.locator('#file');
    const fileInputLabel = page.locator('label[for="file"]');

    // Wait for elements to be stable
    await jumpButton.waitFor();
    await fileInput.waitFor();

    // Check if the button covers the file input or label
    // We can check bounding boxes
    const buttonBox = await jumpButton.boundingBox();
    const inputBox = await fileInput.boundingBox();
    const labelBox = await fileInputLabel.boundingBox();

    // Helper to check intersection
    const intersects = (box1, box2) => {
        if (!box1 || !box2) return false;
        return !(box2.x >= box1.x + box1.width ||
                 box2.x + box2.width <= box1.x ||
                 box2.y >= box1.y + box1.height ||
                 box2.y + box2.height <= box1.y);
    };

    // If they intersect, the test should fail
    if (buttonBox && inputBox) {
        const isOverlappingInput = intersects(buttonBox, inputBox);
        expect(isOverlappingInput, `Jump to Sticker Editor button overlaps with file input. Button: ${JSON.stringify(buttonBox)}, Input: ${JSON.stringify(inputBox)}`).toBeFalsy();
    }

    if (buttonBox && labelBox) {
        const isOverlappingLabel = intersects(buttonBox, labelBox);
        expect(isOverlappingLabel, `Jump to Sticker Editor button overlaps with file input label. Button: ${JSON.stringify(buttonBox)}, Label: ${JSON.stringify(labelBox)}`).toBeFalsy();
    }
  });

  test('Small mobile viewport (320px) overlap check', async ({ page }) => {
    // Explicitly set a small viewport
    await page.setViewportSize({ width: 320, height: 600 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const jumpButton = page.locator('nav.top-menu-bar .menu-item').filter({ hasText: 'Jump to Sticker Editor' });
    const fileInput = page.locator('#file');

    await jumpButton.waitFor();

    const buttonBox = await jumpButton.boundingBox();
    const inputBox = await fileInput.boundingBox();

    const intersects = (box1, box2) => {
        if (!box1 || !box2) return false;
        return !(box2.x >= box1.x + box1.width ||
                 box2.x + box2.width <= box1.x ||
                 box2.y >= box1.y + box1.height ||
                 box2.y + box2.height <= box1.y);
    };

    if (buttonBox && inputBox) {
        const isOverlapping = intersects(buttonBox, inputBox);
        expect(isOverlapping, `Jump to Sticker Editor button overlaps with file input on small screen. Button: ${JSON.stringify(buttonBox)}, Input: ${JSON.stringify(inputBox)}`).toBeFalsy();
    }
  });

  test('Anchor navigation should not be obscured by fixed elements', async ({ page, isMobile }) => {
    if (!isMobile) test.skip();

    await page.goto('/');

    const jumpButton = page.locator('nav.top-menu-bar .menu-item').filter({ hasText: 'Jump to Sticker Editor' });
    const fileInput = page.locator('#file');

    // Click the jump button to scroll to the element
    await jumpButton.click();

    // Wait for scroll (simple timeout or polling scroll position might be needed, but click usually triggers it)
    await page.waitForTimeout(1000); // Give it time to scroll

    const buttonBox = await jumpButton.boundingBox();
    const inputBox = await fileInput.boundingBox();

    const intersects = (box1, box2) => {
        if (!box1 || !box2) return false;
        return !(box2.x >= box1.x + box1.width ||
                 box2.x + box2.width <= box1.x ||
                 box2.y >= box1.y + box1.height ||
                 box2.y + box2.height <= box1.y);
    };

    if (buttonBox && inputBox) {
        const isOverlapping = intersects(buttonBox, inputBox);
        // This is where we expect it might fail if scroll-margin-top is not set
        expect(isOverlapping, `Jump to Sticker Editor button overlaps with file input after navigation. Button: ${JSON.stringify(buttonBox)}, Input: ${JSON.stringify(inputBox)}`).toBeFalsy();
    }
  });

});
