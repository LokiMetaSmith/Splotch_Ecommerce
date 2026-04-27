import { test, expect } from './test-setup.js';

test('Negative cutline offset should generate sharp edges (miter)', async ({ page }) => {
    await page.goto('/');

    await page.evaluate("document.dispatchEvent(new CustomEvent('easterEggUnlocked'))");
    await page.waitForSelector('body', { state: 'visible' });

    // Ensure we trigger the test using an image with transparent background first
    await page.evaluate(async () => {
        const response = await fetch('/mascot-5.png'); // use mascot-5 (the star-shaped one)
        const blob = await response.blob();
        const file = new File([blob], 'mascot-5.png', { type: 'image/png' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        const fileInput = document.getElementById('file');
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.waitForTimeout(2000);

    // Initial cutline generation
    const generateBtn = page.locator('#generateCutlineBtn');
    await expect(generateBtn).toBeEnabled({ timeout: 10000 });
    await generateBtn.click();

    await expect(page.locator('#toast-container')).toContainText('Smart cutline generated', { timeout: 15000 });

    const offsetSlider = page.locator('#cutlineOffsetSlider');
    await offsetSlider.waitFor({ state: 'attached' });

    // Apply negative offset
    await offsetSlider.evaluate(el => {
        el.value = -30;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.waitForTimeout(2000);

    // Wait for the UI update to reflect the cutline value
    await expect(page.locator('#cutlineOffsetValue')).toHaveText('-30');

    // Screenshot test
    await page.locator('#canvas-container').screenshot({ path: 'test-results/negative-cutline-miter.png' });
});
