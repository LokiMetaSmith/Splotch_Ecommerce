import { test, expect } from '../playwright_tests/test-setup.js';

test.describe('Mobile Canvas Controls & UI Features', () => {
  test('mobile canvas controls should be visible on mobile and hidden on desktop', async ({ page, isMobile }) => {
    await page.goto('/');

    const mobileControls = page.locator('#mobile-canvas-controls');
    await expect(mobileControls).toBeAttached();

    if (isMobile) {
      await expect(mobileControls).toBeVisible();
    } else {
      await expect(mobileControls).toBeHidden();
    }
  });

  test('mobile controls manipulate active sticker transformations (rotate, scale, fit/center)', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile canvas controls are only displayed on mobile viewports');

    await page.goto('/?debug=true');

    // Wait for page ready
    await expect(page.locator('.animate-spin.h-4.w-4')).toHaveCount(0, { timeout: 15000 });

    // Simulate uploading a sticker image directly in browser using exposed helper
    await page.evaluate(() => {
      return new Promise((resolve) => {
        const c = document.createElement('canvas');
        c.width = 400;
        c.height = 400;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(50, 50, 300, 300);

        const img = new Image();
        img.onload = () => {
          if (window.__addSticker) {
            const sticker = window.__addSticker(img, "Test Sticker", 100, 100, 200, 200);
            sticker.originalImage = img;
          }
          if (window.__doRedrawAll) window.__doRedrawAll();
          resolve();
        };
        img.src = c.toDataURL();
      });
    });

    // Wait a brief moment for the sticker to attach
    await page.waitForTimeout(300);

    // Initial state check
    let state = await page.evaluate(() => {
      const s = window.__getActiveSticker ? window.__getActiveSticker() : null;
      return { rotation: s?.rotation || 0, width: s?.width || 0, height: s?.height || 0, x: s?.x || 0, y: s?.y || 0 };
    });
    expect(state.rotation).toBe(0);
    expect(state.width).toBe(200);

    // 1. Test Rotate button (+90 degrees)
    const rotateBtn = page.locator('#mobileRotateBtn');
    await rotateBtn.click();
    state = await page.evaluate(() => {
      const s = window.__getActiveSticker ? window.__getActiveSticker() : null;
      return { rotation: s?.rotation || 0 };
    });
    expect(state.rotation).toBe(90);

    // Rotate again -> 180 degrees
    await rotateBtn.click();
    state = await page.evaluate(() => {
      const s = window.__getActiveSticker ? window.__getActiveSticker() : null;
      return { rotation: s?.rotation || 0 };
    });
    expect(state.rotation).toBe(180);

    // 2. Test Scale Up button (1.1x factor)
    const scaleUpBtn = page.locator('#mobileScaleUpBtn');
    const widthBeforeScaleUp = await page.evaluate(() => {
      const s = window.__getActiveSticker ? window.__getActiveSticker() : null;
      return s?.width || 0;
    });
    await scaleUpBtn.click();
    const widthAfterScaleUp = await page.evaluate(() => {
      const s = window.__getActiveSticker ? window.__getActiveSticker() : null;
      return s?.width || 0;
    });
    expect(widthAfterScaleUp).toBeCloseTo(widthBeforeScaleUp * 1.1, 1);

    // 3. Test Scale Down button (0.9x factor)
    const scaleDownBtn = page.locator('#mobileScaleDownBtn');
    await scaleDownBtn.click();
    const widthAfterScaleDown = await page.evaluate(() => {
      const s = window.__getActiveSticker ? window.__getActiveSticker() : null;
      return s?.width || 0;
    });
    expect(widthAfterScaleDown).toBeCloseTo(widthAfterScaleUp * 0.9, 1);

    // 4. Test Fit / Center button
    const centerBtn = page.locator('#mobileCenterBtn');
    await centerBtn.click();
    const stateAfterCenter = await page.evaluate(() => {
      const s = window.__getActiveSticker ? window.__getActiveSticker() : null;
      return { rotation: s?.rotation, x: s?.x, y: s?.y, width: s?.width, height: s?.height };
    });
    // Center button resets rotation to 0
    expect(stateAfterCenter.rotation).toBe(0);
    // And centers within canvas
    expect(stateAfterCenter.x).toBeGreaterThan(0);
    expect(stateAfterCenter.y).toBeGreaterThan(0);
  });

  test('custom cutline upload section is collapsible via details/summary', async ({ page, isMobile }) => {
    await page.goto('/');

    if (isMobile) {
      const cutlinesTab = page.locator('button[data-tab="cutlines"]');
      await cutlinesTab.click();
    }

    const details = page.locator('details.field');
    await expect(details).toBeAttached();

    // Verify summary text
    const summary = details.locator('summary');
    await expect(summary).toContainText('Advanced: Upload Custom Cutline (.AI, .SVG, .PDF)');

    // Verify initial closed state
    const isOpenInitial = await details.evaluate((el) => el.hasAttribute('open'));
    expect(isOpenInitial).toBe(false);

    // Click summary to expand
    await summary.click();
    const isOpenAfterClick = await details.evaluate((el) => el.hasAttribute('open'));
    expect(isOpenAfterClick).toBe(true);

    // Cutline file input should be visible when open
    const fileInput = details.locator('#cutLineFile');
    await expect(fileInput).toBeVisible();

    // Click summary again to collapse
    await summary.click();
    const isOpenAfterSecondClick = await details.evaluate((el) => el.hasAttribute('open'));
    expect(isOpenAfterSecondClick).toBe(false);
  });

  test('developer status indicator displays when ?debug=true is in URL', async ({ page }) => {
    // Normal visit without debug
    await page.goto('/');
    const statusIndicator = page.locator('#status-indicator');
    await expect(statusIndicator).toBeAttached();
    const isHiddenNormal = await statusIndicator.evaluate((el) => el.classList.contains('hidden'));
    expect(isHiddenNormal).toBe(true);

    // Visit with ?debug=true
    await page.goto('/?debug=true');
    const statusIndicatorDebug = page.locator('#status-indicator');
    await expect(statusIndicatorDebug).toBeVisible();
    const isHiddenDebug = await statusIndicatorDebug.evaluate((el) => el.classList.contains('hidden'));
    expect(isHiddenDebug).toBe(false);
  });
});
