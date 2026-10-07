import { test, expect } from './test-setup.js';

test.describe('Material Base Color Canvas Rendering', () => {
  test('correctly renders white substrate for white film and transparent substrate for clear cling and flat acrylic', async ({ page }) => {
    await page.goto('/');

    // Upload transparent image
    const testImagePath = 'public/mascot.png';
    await page.setInputFiles('#file', testImagePath);
    await page.waitForFunction(() => window.stickers && window.stickers.length > 0 && !!window.stickers[0].image);
    await page.waitForTimeout(1500);

    const materialSelect = page.locator('#stickerMaterial');
    const badge = page.locator('#material-base-badge');
    const bgMagentaBtn = page.locator('#bgMagentaBtn');

    // 1. Initial State: White Backed Film (pp_standard)
    await expect(materialSelect).toHaveValue('pp_standard');
    await expect(badge).toHaveText('White Film Substrate');

    // 2. Switch to Clear Static Cling
    await materialSelect.selectOption('clear_cling', { force: true });
    await expect(badge).toHaveText('Clear / Transparent Base');

    // Toggle Magenta background
    await bgMagentaBtn.click();
    await page.waitForTimeout(500);

    // Verify canvas background is not occluded by white inside transparent area
    const cornerPixel = await page.evaluate(() => {
      const canvas = document.getElementById('imageCanvas');
      const ctx = canvas.getContext('2d');
      const imgData = ctx.getImageData(10, 10, 1, 1).data;
      return { r: imgData[0], g: imgData[1], b: imgData[2], a: imgData[3] };
    });
    expect(cornerPixel.a).toBe(0);

    // 3. Switch to Flat Acrylic
    await materialSelect.selectOption('flat_acrylic', { force: true });
    await expect(badge).toHaveText('Clear / Transparent Base');

    // 4. Switch back to White Backed Film
    await materialSelect.selectOption('pp_standard', { force: true });
    await expect(badge).toHaveText('White Film Substrate');
  });
});
