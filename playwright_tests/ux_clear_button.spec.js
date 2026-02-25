import { test, expect } from './test-setup.js';

test('allows a user to clear the uploaded image', async ({ page }) => {
  await page.goto('/');

  // Verify Clear button is hidden initially
  const clearBtn = page.locator('#clearFileBtn');
  await expect(clearBtn).toBeHidden();

  // Upload an image
  const fileChooserPromise = page.waitForEvent('filechooser');
  // We use the label because the input itself might be hidden or styled
  await page.locator('label[for="file"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('public/mascot.png');

  // Verify image loaded (wait for rotate button enabled)
  await expect(page.locator('#rotateLeftBtn')).toBeEnabled({ timeout: 10000 });

  // Verify Clear button is now visible
  await expect(clearBtn).toBeVisible();

  // Handle confirmation dialog
  page.on('dialog', dialog => dialog.accept());

  // Click Clear button
  await clearBtn.click();

  // Verify image is cleared:
  // 1. Placeholder should be visible
  await expect(page.locator('#canvas-placeholder')).toBeVisible();
  // 2. Rotate button should be disabled (or have disabled class)
  await expect(page.locator('#rotateLeftBtn')).toBeDisabled();
  // 3. Clear button should be hidden again
  await expect(clearBtn).toBeHidden();
  // 4. File input value should be empty
  const fileInput = page.locator('#file');
  const value = await fileInput.inputValue();
  expect(value).toBe('');
  // 5. Filename display should be empty
  const fileNameDisplay = page.locator('#fileNameDisplay');
  await expect(fileNameDisplay).toHaveText('');
});
