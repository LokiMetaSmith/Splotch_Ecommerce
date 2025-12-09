import { test, expect } from './test-setup.js';

test.describe('Mascot Integration', () => {
  test('should load a random mascot image', async ({ page }) => {
    await page.goto('/');

    const mascotImg = page.locator('#mascot-img');
    await expect(mascotImg).toBeVisible();

    const src = await mascotImg.getAttribute('src');
    const validSrcs = [
        '/mascot.png',
        '/mascot-1.png',
        '/mascot-2.png',
        '/mascot-3.png',
        '/mascot-4.png',
        '/mascot-5.png',
        '/mascot-6.png',
        '/mascot-7.png'
    ];
    // Check if the src matches one of the valid paths (considering potential base URL differences if any, usually validSrcs match what we set)
    // Note: src might be absolute url, so checking endsWith is safer.
    const isSrcValid = validSrcs.some(s => src.endsWith(s));
    expect(isSrcValid, `Mascot src "${src}" should end with one of ${validSrcs.join(', ')}`).toBeTruthy();
  });

  test('should wiggle when mouse is near', async ({ page }) => {
    await page.goto('/');
    const mascotContainer = page.locator('#mascot-container');

    // Get mascot position
    const box = await mascotContainer.boundingBox();
    expect(box).not.toBeNull();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Move mouse far away (0, 0 is usually top left, mascot is bottom right)
    await page.mouse.move(0, 0);
    // Ensure wiggle class is not present initially (might take a frame to update if mouse started near)
    await expect(mascotContainer).not.toHaveClass(/wiggle/);

    // Move mouse near (e.g. 100px away)
    // Since mascot is bottom right, moving to centerX - 100, centerY - 100 should be near enough (< 300)
    await page.mouse.move(centerX - 100, centerY - 100);
    await expect(mascotContainer).toHaveClass(/wiggle/);

    // Move away again
    await page.mouse.move(0, 0);
    await expect(mascotContainer).not.toHaveClass(/wiggle/);
  });
});
