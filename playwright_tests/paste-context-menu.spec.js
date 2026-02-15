import { test, expect } from '@playwright/test';

test('placeholder should be contenteditable to allow context menu paste', async ({ page }) => {
  await page.goto('/');

  const placeholder = page.locator('#canvas-placeholder');
  await expect(placeholder).toBeVisible();

  // Check that contenteditable is effectively true (inherited) or not explicitly false
  const isContentEditable = await placeholder.evaluate((el) => {
    return el.isContentEditable;
  });

  expect(isContentEditable).toBe(true);
});
