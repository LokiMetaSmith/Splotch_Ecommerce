import { test, expect } from '@playwright/test';
import path from 'path';

test('reproduce multiple cutlines bug', async ({ page }) => {
  // Handle confirm dialogs automatically (accept them)
  page.on('dialog', dialog => dialog.accept());

  // Check for any console errors
  page.on('console', msg => {
      console.log(`BROWSER LOG: ${msg.text()}`);
  });

  console.log("Navigating to /");
  await page.goto('/');

  // Wait for BootStrap to complete async initialization
  await page.waitForFunction(() => window.__appInitialized === true);

  // Unlock the easter egg so the button is visible
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('easterEggUnlocked')));
  // 2. Upload an image
  const fileInput = page.locator('input[type="file"]#file');
  await fileInput.waitFor({ state: 'attached' });

  // Use absolute path
  const imagePath = path.resolve('public/mascot.png');
  await fileInput.setInputFiles(imagePath);

  // Wait for image to load
  await expect(page.locator('#toast-container')).toContainText('Image loaded successfully', { timeout: 15000 });

  // 3. Generate Smart Cutline (needed for rasterCutlinePoly)
  const generateBtn = page.locator('#generateCutlineBtn');
  await expect(generateBtn).toBeEnabled();
  await generateBtn.click();

  // 4. Wait for generation to complete
  await expect(page.locator('#toast-container')).toContainText('Smart cutline generated successfully', { timeout: 30000 });

  // 5. Move the slider multiple times to trigger the bug
  const slider = page.locator('#cutlineOffsetSlider');

  // Simulate rapid changes using valid step values (0, 1, 2)
  for (let val of [0, 1, 2, 1, 0]) {
      await slider.fill(String(val));
      // Dispatch input event to trigger the listener
      await slider.dispatchEvent('input');
      // Small delay to allow rendering
      await page.waitForTimeout(100);
  }

  // 6. Take screenshot to visually confirm multiple lines
  await page.screenshot({ path: 'reproduction_bug.png' });
});
