import { test, expect } from '../playwright_tests/test-setup.js';
import path from 'path';

test.describe('Bounding Circle Boundary Precision', () => {
  const svgPath = path.join(process.cwd(), 'public', 'templates', 'thank_you.svg');

  test('should tightly bound round sticker when margin is 0 without diagonal inflation', async ({ page }) => {
    await page.goto('/');

    // 1. Upload the circular Thank You SVG directly
    await page.setInputFiles('#file', svgPath);

    // Wait for Sheet Boundary item to appear in sticker list
    const sheetBoundaryItem = page.locator('#sheet-boundary-item');
    await expect(sheetBoundaryItem).toBeVisible({ timeout: 20000 });
    await sheetBoundaryItem.click({ force: true });

    // 2. Select Bounding Circle in Sheet Boundary Settings
    const shapeSelect = page.locator('#boundaryShapeSelect');
    await expect(shapeSelect).toBeVisible({ timeout: 10000 });
    await shapeSelect.selectOption('circle');

    // 3. Ensure margin is 0
    const marginInput = page.locator('#boundaryMarginInput');
    await marginInput.fill('0');
    await marginInput.dispatchEvent('input');
    await marginInput.fill('0');
    await marginInput.dispatchEvent('change');

    await page.waitForTimeout(1000);

    // 4. Evaluate dimensions
    const widthVal = await page.locator('#widthInput').inputValue();
    const heightVal = await page.locator('#heightInput').inputValue();

    const widthNum = parseFloat(widthVal);
    const heightNum = parseFloat(heightVal);

    console.log('Calculated dimensions with margin 0:', widthNum, 'x', heightNum);

    // The circular sticker is ~2.8 to ~3.0 inches (NOT 3.9+ inches as previously inflated by sqrt(2))
    expect(widthNum).toBeLessThan(3.3);
    expect(heightNum).toBeLessThan(3.3);
    expect(Math.abs(widthNum - heightNum)).toBeLessThan(0.2);
  });
});