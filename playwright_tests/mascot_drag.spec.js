import { test, expect } from './test-setup.js';

test.describe('Mascot Drag and Drop', () => {
  test('drag mascot test', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('easterEggUnlocked')));

    // Dispatch a drop event manually
    await page.evaluate(() => {
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('application/x-mascot-drag', 'true');
      dataTransfer.setData('text/uri-list', '/mascot.png');
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer });

      document.querySelector('#canvas-placeholder').dispatchEvent(dropEvent);
    });

    // Give it a moment to fetch the image, process it, and update the UI
    const resizeInput = page.locator('#resizeInput');

    // Check that the value is 2.8 after dragging the mascot
    await expect(resizeInput).toHaveValue('2.8', { timeout: 10000 });

    const canvas = page.locator('#canvas-container');
    // Wait for canvas decorations/image to be fully drawn
    await page.waitForTimeout(1000);
    // Also perform a visual check of the canvas to ensure the mascot is rendered correctly
    // Skip mobile safari as the animations don't fully finish.
    const isMobileSafari = test.info().project.name === 'Mobile Safari';
    if (!isMobileSafari) {
      await expect(canvas).toHaveScreenshot('mascot-canvas-drag-result.png', { maxDiffPixels: 100 });
    }
  });
});
