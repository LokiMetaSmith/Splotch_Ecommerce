import { test, expect } from '@playwright/test';
import path from 'path';

test('reproduce multiple cutlines bug', async ({ page }) => {
  // Handle confirm dialogs automatically (accept them)
  page.on('dialog', dialog => dialog.accept());

  await page.goto('/');

  // Wait for app initialization (simple delay to avoid race conditions)
  await page.waitForTimeout(5000);

  // Check for any console errors
  page.on('console', msg => {
    if (msg.type() === 'error')
      console.log(`Page Error: "${msg.text()}"`);
  });

  // 2. Upload an image
  const fileInput = page.locator('input[type="file"]#file');
  await fileInput.waitFor({ state: 'attached' });

  // Use absolute path
  const imagePath = path.resolve('public/mascot.png');
  await fileInput.setInputFiles(imagePath);

  // Wait for image to load
  await expect(page.locator('#payment-status-container')).toContainText('Image loaded successfully', { timeout: 15000 });

  // 3. Generate Smart Cutline (needed for rasterCutlinePoly)
  const generateBtn = page.locator('#generateCutlineBtn');
  await expect(generateBtn).toBeEnabled();
  await generateBtn.click();

  // 4. Wait for generation to complete
  await expect(page.locator('#payment-status-container')).toContainText('Smart cutline generated successfully', { timeout: 30000 });

  // 5. Move the slider multiple times to trigger the bug
  const slider = page.locator('#cutlineOffsetSlider');

  // Simulate rapid changes
  for (let i = 0; i < 5; i++) {
      const val = 10 + i * 5;
      await slider.fill(String(val));
      // Dispatch input event to trigger the listener
      await slider.dispatchEvent('input');
      // Small delay to allow rendering
      await page.waitForTimeout(100);
  }

  // 6. Take screenshot to visually confirm multiple lines
  await page.screenshot({ path: 'reproduction_bug.png' });
});
