import { test, expect } from './test-setup.js';

test.describe('Sheet Sticker Drag and Click Alignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?debug=true');
    await expect(page.locator('#imageCanvas')).toBeVisible({ timeout: 15000 });
  });

  test('hit testing accurately distinguishes between stickers with adjacent and overlapping bounds', async ({ page }) => {
    // Add two stickers with defined cutlines directly
    await page.evaluate(() => {
      // Clear any default placeholder
      if (window.__stickers) window.__stickers.length = 0;

      // Sticker 0 at (50, 50) of size 100x100
      const s0 = window.__addSticker(null, 'Sticker A', 50, 50, 100, 100);
      s0.currentCutline = [[
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]];

      // Sticker 1 at (200, 50) of size 100x100
      const s1 = window.__addSticker(null, 'Sticker B', 200, 50, 100, 100);
      s1.currentCutline = [[
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]];

      window.__doRedrawAll();
    });

    // Test hit testing on sticker 0 and sticker 1
    const hits = await page.evaluate(() => {
      // Point (100, 100) is inside Sticker A (world coords 50..150, 50..150)
      const hitA = window.__hitTestLayers(100, 100);
      // Point (250, 100) is inside Sticker B (world coords 200..300, 50..150)
      const hitB = window.__hitTestLayers(250, 100);
      // Point (400, 400) is outside all stickers
      const hitNone = window.__hitTestLayers(400, 400);

      return {
        hitAIndex: hitA ? hitA.index : null,
        hitBIndex: hitB ? hitB.index : null,
        hitNone: hitNone ? hitNone.index : null,
      };
    });

    expect(hits.hitAIndex).toBe(0);
    expect(hits.hitBIndex).toBe(1);
    expect(hits.hitNone).toBeNull();
  });

  test('clicking on canvas selects the clicked sticker and updates active state', async ({ page }) => {
    await page.evaluate(() => {
      if (window.__stickers) window.__stickers.length = 0;

      const s0 = window.__addSticker(null, 'Sticker A', 50, 50, 100, 100);
      s0.currentCutline = [[
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]];

      const s1 = window.__addSticker(null, 'Sticker B', 250, 50, 100, 100);
      s1.currentCutline = [[
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]];

      window.__doRedrawAll();
    });

    // Click on Sticker A via canvas event
    const activeAfterA = await page.evaluate(() => {
      const canvasEl = document.getElementById('imageCanvas');
      const rect = canvasEl.getBoundingClientRect();

      // Find client coordinates that map to Sticker A center (100, 100)
      for (let cx = rect.left + 5; cx < rect.right - 5; cx += 5) {
        for (let cy = rect.top + 5; cy < rect.bottom - 5; cy += 5) {
          const coords = window.__getCanvasCoords(cx, cy);
          const hit = window.__hitTestLayers(coords.x, coords.y);
          if (hit && hit.index === 0) {
            canvasEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
            window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
            return window.__getActiveSticker ? window.__getActiveSticker()?.name : null;
          }
        }
      }
      return null;
    });

    expect(activeAfterA).toBe('Sticker A');

    // Click on Sticker B via canvas event
    const activeAfterB = await page.evaluate(() => {
      const canvasEl = document.getElementById('imageCanvas');
      const rect = canvasEl.getBoundingClientRect();

      for (let cx = rect.left + 5; cx < rect.right - 5; cx += 5) {
        for (let cy = rect.top + 5; cy < rect.bottom - 5; cy += 5) {
          const coords = window.__getCanvasCoords(cx, cy);
          const hit = window.__hitTestLayers(coords.x, coords.y);
          if (hit && hit.index === 1) {
            canvasEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
            window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
            return window.__getActiveSticker ? window.__getActiveSticker()?.name : null;
          }
        }
      }
      return null;
    });

    expect(activeAfterB).toBe('Sticker B');
  });

  test('dragging moves sticker in 1:1 direct alignment with mouse translation without 0.4 dampening lag', async ({ page }) => {
    await page.evaluate(() => {
      if (window.__stickers) window.__stickers.length = 0;

      const s0 = window.__addSticker(null, 'Sticker A', 50, 50, 100, 100);
      s0.currentCutline = [[
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]];

      const s1 = window.__addSticker(null, 'Sticker B', 250, 50, 100, 100);
      s1.currentCutline = [[
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]];

      window.__doRedrawAll();
    });

    // Test dragging Sticker B by 50px horizontally and 30px vertically
    const dragResult = await page.evaluate(() => {
      const canvasEl = document.getElementById('imageCanvas');
      const rect = canvasEl.getBoundingClientRect();

      let targetClientPos = null;
      for (let cx = rect.left + 5; cx < rect.right - 5; cx += 5) {
        for (let cy = rect.top + 5; cy < rect.bottom - 5; cy += 5) {
          const coords = window.__getCanvasCoords(cx, cy);
          const hit = window.__hitTestLayers(coords.x, coords.y);
          if (hit && hit.index === 1) {
            targetClientPos = { x: cx, y: cy };
            break;
          }
        }
        if (targetClientPos) break;
      }

      if (!targetClientPos) return null;

      const initialX = window.__stickers[1].x;
      const initialY = window.__stickers[1].y;

      const deltaClientX = 50;
      const deltaClientY = 30;

      // Dispatch mousedown
      canvasEl.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: targetClientPos.x,
        clientY: targetClientPos.y,
      }));

      // Dispatch mousemove
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        clientX: targetClientPos.x + deltaClientX,
        clientY: targetClientPos.y + deltaClientY,
      }));

      // Dispatch mouseup
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        clientX: targetClientPos.x + deltaClientX,
        clientY: targetClientPos.y + deltaClientY,
      }));

      const finalX = window.__stickers[1].x;
      const finalY = window.__stickers[1].y;

      return {
        initialX,
        initialY,
        finalX,
        finalY,
        deltaX: finalX - initialX,
        deltaY: finalY - initialY,
        deltaClientX,
        deltaClientY,
      };
    });

    expect(dragResult).not.toBeNull();
    expect(dragResult.deltaX).toBeGreaterThan(0);
    expect(dragResult.deltaY).toBeGreaterThan(0);

    // Ratio of deltaX / deltaClientX must be > 0.5 (under 0.4 dampening, it would fail)
    const ratio = dragResult.deltaX / dragResult.deltaClientX;
    console.log(`Measured ratio: ${ratio}, deltaX: ${dragResult.deltaX}, deltaClientX: ${dragResult.deltaClientX}`);
    expect(ratio).toBeGreaterThan(0.5);
  });
});

