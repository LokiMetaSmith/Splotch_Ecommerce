import { test, expect } from '@playwright/test';

test.describe('Mascot Accessibility', () => {
  test('Mascot speech bubble should be visible on keyboard focus and accessible', async ({ page }) => {
    // Navigate to the home page
    await page.goto('/');

    // Locate the mascot container
    const mascotContainer = page.locator('#mascot-container');
    const speechBubble = page.locator('#mascot-text');

    // Ensure mascot is visible initially
    await expect(mascotContainer).toBeVisible();

    // Verify speech bubble is hidden initially
    await expect(speechBubble).not.toBeVisible();

    // Verify ARIA attribute (Should fail initially)
    await expect(mascotContainer).toHaveAttribute('aria-describedby', 'mascot-text');

    // Focus the mascot container to test :focus-visible or :focus state
    // We use keyboard tab to ensure :focus-visible is triggered if the browser supports it
    // But since tabbing is tedious, we can try to force it or just use .focus()
    // and ensuring our CSS supports both or we accept .focus() limitation.
    // For this test, let's try to rely on .focus(). If Playwright's browser behaves standardly,
    // .focus() might not trigger :focus-visible.
    // Let's try to fake a Tab press from the previous element?
    // Or just use page.keyboard.press('Tab') repeatedly? No.

    // Workaround: We can check if the element matches :focus-visible selector in evaluate
    // But we want to check VISIBILITY of the bubble.

    // Let's try standard focus.
    await mascotContainer.focus();

    // If the bubble is still hidden, it means either:
    // 1. CSS is not applied (expected failure before fix)
    // 2. .focus() didn't trigger :focus-visible (possible false negative after fix)

    // To avoid false negatives, we will ALSO assert that the CSS rule exists or just trust focus().
    // Actually, to trigger focus-visible in tests, we can use:
    // await page.keyboard.press('Tab');
    // IF we are focused on the body/start.
    // But we don't know where we are.

    // Let's just assert visibility. If it fails, I'll debug.
    await expect(speechBubble).toBeVisible();
  });
});
