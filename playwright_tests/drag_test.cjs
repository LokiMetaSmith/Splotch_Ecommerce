const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('http://localhost:3000/printshop.html', { waitUntil: 'networkidle' });

  // Wait for the backend to become ready, otherwise the upload fails or similar issues happen.
  // Actually, we don't need a real backend for just local rendering, but let's wait a moment just in case.
  await page.waitForTimeout(2000);

  // Accept cookies to get rid of banner
  try {
     await page.click('button:has-text("Accept")', { timeout: 2000 });
     await page.waitForTimeout(1000);
  } catch (e) { }

  // Upload the file via the label
  const fileInput = await page.$('input#file');
  await fileInput.setInputFiles('image.png');

  // Wait for the image to load
  await page.waitForTimeout(3000);

  // Generate a cutline first by triggering the transparent edge logic
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('easterEggUnlocked'));
  });

  // Wait for "Generate Smart Cutline" button to be visible and click it
  await page.waitForSelector('#magicEdgeBtn', { state: 'visible', timeout: 5000 });
  await page.click('#magicEdgeBtn');

  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'before_drag.png' });

  // Drag the canvas
  const canvas = await page.$('canvas#canvas');
  const box = await canvas.boundingBox();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 100, { steps: 10 });
  await page.mouse.up();

  await page.waitForTimeout(1000);

  await page.screenshot({ path: 'after_drag.png' });

  await browser.close();
})();
