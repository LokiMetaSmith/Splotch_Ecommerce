import { test, expect } from '../playwright_tests/test-setup.js';
import fs from 'fs';
import path from 'path';

const pricingConfig = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'server', 'pricing.json'), 'utf8')
);

test.describe('Dynamic Material & Finish Dropdown', () => {
  test('should populate stickerMaterial select from pricingConfig and update helper text on change', async ({ page }) => {
    await page.goto('/');

    const materialSelect = page.locator('#stickerMaterial');
    await expect(materialSelect).toBeVisible();

    // Wait for options to be populated from pricingConfig
    await expect(materialSelect.locator('option')).toHaveCount(pricingConfig.materials.length);

    // Check that options match pricingConfig.materials
    const optionValues = await materialSelect.locator('option').evaluateAll((options) =>
      options.map((o) => ({ value: o.value, text: o.textContent.trim() }))
    );

    console.log('Populated material options:', optionValues);

    expect(optionValues.length).toBe(pricingConfig.materials.length);
    for (let i = 0; i < pricingConfig.materials.length; i++) {
      expect(optionValues[i].value).toBe(pricingConfig.materials[i].id);
      expect(optionValues[i].text).toBe(pricingConfig.materials[i].name);
    }

    // Default selection should be pp_standard
    await expect(materialSelect).toHaveValue('pp_standard');

    // Helper text should match description of pp_standard
    const helperEl = page.locator('#material-helper');
    const ppDesc = pricingConfig.materials.find((m) => m.id === 'pp_standard').description;
    await expect(helperEl).toHaveText(ppDesc);

    // Change selection to pvc_laminated
    await materialSelect.selectOption('pvc_laminated');
    const pvcDesc = pricingConfig.materials.find((m) => m.id === 'pvc_laminated').description;
    await expect(helperEl).toHaveText(pvcDesc);

    // Change selection to finish_holographic
    await materialSelect.selectOption('finish_holographic');
    const holoDesc = pricingConfig.materials.find((m) => m.id === 'finish_holographic').description;
    await expect(helperEl).toHaveText(holoDesc);
  });
});
