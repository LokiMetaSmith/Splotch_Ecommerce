import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

describe('Laser Cut Acrylic Badge Template', () => {
  const templatePath = path.join(process.cwd(), 'public', 'templates', 'acrylic_badge.svg');

  test('acrylic_badge.svg file exists', () => {
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  test('acrylic_badge.svg contains valid SVG with rounded badge and oval slot', () => {
    const svgContent = fs.readFileSync(templatePath, 'utf-8');
    const dom = new JSDOM(svgContent, { contentType: 'image/svg+xml' });
    const svg = dom.window.document.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg.getAttribute('viewBox')).toBe('0 0 400 250');

    // Outer rounded rectangle badge
    const rects = Array.from(svg.querySelectorAll('rect'));
    const outerRect = rects.find(
      (r) => parseFloat(r.getAttribute('width')) >= 350 && parseFloat(r.getAttribute('rx')) >= 10
    );
    expect(outerRect).toBeDefined();
    expect(parseFloat(outerRect.getAttribute('rx'))).toBe(20);

    // Centered oval slot for lanyard clip (~1cm wide)
    const slotGroup = svg.querySelector('#lanyard-slot');
    expect(slotGroup).not.toBeNull();

    const slotRect = slotGroup.querySelector('rect');
    expect(slotRect).not.toBeNull();

    const slotWidth = parseFloat(slotRect.getAttribute('width'));
    const slotHeight = parseFloat(slotRect.getAttribute('height'));
    const slotRx = parseFloat(slotRect.getAttribute('rx'));
    const slotX = parseFloat(slotRect.getAttribute('x'));

    // Check slot dimensions: ~38px (~1 cm at standard screen/print scale)
    expect(slotWidth).toBeGreaterThanOrEqual(30);
    expect(slotWidth).toBeLessThanOrEqual(50);
    expect(slotHeight).toBeGreaterThanOrEqual(8);
    expect(slotHeight).toBeLessThanOrEqual(16);
    expect(slotRx).toBeGreaterThan(0);

    // Check slot is centered horizontally (x + width / 2 ≈ 200)
    const slotCenterX = slotX + slotWidth / 2;
    expect(slotCenterX).toBeCloseTo(200, 1);
  });

  test('index.html contains templateAcrylicBadgeBtn button', () => {
    const htmlPath = path.join(process.cwd(), 'index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const dom = new JSDOM(htmlContent);
    const badgeBtn = dom.window.document.getElementById('templateAcrylicBadgeBtn');

    expect(badgeBtn).not.toBeNull();
    expect(badgeBtn.getAttribute('data-template')).toBe('acrylic_badge');
    expect(badgeBtn.textContent.trim()).toBe('Acrylic Badge');
  });
});
