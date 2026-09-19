/** @jest-environment jsdom */
import { describe, test, expect, beforeAll, beforeEach, jest } from '@jest/globals';

// Mocks for browser/crypto libraries used in printshop.js
jest.unstable_mockModule('jose', () => ({}));
jest.unstable_mockModule('jspdf', () => ({ jsPDF: jest.fn() }));
jest.unstable_mockModule('svg2pdf.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('html5-qrcode', () => ({ Html5Qrcode: jest.fn() }));
jest.unstable_mockModule('@simplewebauthn/browser', () => ({
  startRegistration: jest.fn(),
  startAuthentication: jest.fn()
}));

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  })
);

const {
  renderPricingEditor,
  runSimulator,
  ui
} = await import('../../src/printshop.js');

describe('Print Shop Live Pricing Sandbox & Fulfillment Simulator', () => {
  const sampleConfig = {
    pricePerSquareInchCents: 11,
    resolutions: [
      { id: 'dpi_300', name: '300 DPI (Standard)', ppi: 300, costMultiplier: 1.0 },
      { id: 'dpi_600', name: '600 DPI (High Quality)', ppi: 600, costMultiplier: 1.2 }
    ],
    materials: [
      { id: 'pp_standard', name: 'Gloss White Vinyl', costMultiplier: 1.0 }
    ],
    layers: [
      { id: 'white', name: 'White Underbase', costMultiplier: 1.1 },
      { id: 'cmyk', name: 'CMYK Artwork', costMultiplier: 1.0 }
    ],
    complexity: {
      perLayerMultiplier: 0.05,
      tiers: [
        { thresholdInches: 12, multiplier: 1.0 },
        { thresholdInches: 24, multiplier: 1.1 }
      ]
    },
    quantityDiscounts: [
      { minQuantity: 10, discountPercent: 0.1 },
      { minQuantity: 50, discountPercent: 0.25 },
      { minQuantity: 100, discountPercent: 0.4 }
    ]
  };

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="pricing-editor-container"></div>
    `;
    ui.pricingEditorContainer = document.getElementById('pricing-editor-container');
    renderPricingEditor(sampleConfig);
  });

  test('renders fulfillment and simulator controls in DOM', () => {
    expect(document.getElementById('sim-delivery')).not.toBeNull();
    expect(document.getElementById('sim-state')).not.toBeNull();
    expect(document.getElementById('sim-handling-fee')).not.toBeNull();
    expect(document.getElementById('sim-tradeoffs')).not.toBeNull();

    // Verify itemized result elements exist
    expect(document.getElementById('sim-out-sqin')).not.toBeNull();
    expect(document.getElementById('sim-out-weight')).not.toBeNull();
    expect(document.getElementById('sim-out-undisc')).not.toBeNull();
    expect(document.getElementById('sim-out-subtotal')).not.toBeNull();
    expect(document.getElementById('sim-out-shipping')).not.toBeNull();
    expect(document.getElementById('sim-out-handling')).not.toBeNull();
    expect(document.getElementById('sim-out-tax')).not.toBeNull();
    expect(document.getElementById('sim-out-square')).not.toBeNull();
    expect(document.getElementById('sim-out-total')).not.toBeNull();
    expect(document.getElementById('sim-out-net')).not.toBeNull();
  });

  test('calculates standard USPS shipping to Oklahoma with tax and Square fee', () => {
    // Set 3x3 inches, qty 50
    document.getElementById('sim-width').value = '3';
    document.getElementById('sim-height').value = '3';
    document.getElementById('sim-qty').value = '50';
    document.getElementById('sim-perimeter').value = '12';
    document.getElementById('sim-delivery').value = 'ship';
    document.getElementById('sim-state').value = 'OK';
    document.getElementById('sim-tradeoffs').value = 'none';
    document.getElementById('sim-handling-fee').value = '3.00';

    runSimulator();

    // 3 * 3 = 9.0 sq in
    expect(document.getElementById('sim-out-sqin').textContent).toBe('9.0');
    // Total weight: 9 * 50 = 450 sq in * 0.05g = 22.5g + 28g tare = 50.5g -> 50.5 / 28.3495 = ~1.78 oz
    expect(document.getElementById('sim-out-weight').textContent).toContain('1.8 oz');

    // USPS tier for 1.8 oz: <= 2 oz is $4.70
    expect(document.getElementById('sim-out-ship-label').textContent).toContain('USPS First Class (~2 oz)');
    expect(document.getElementById('sim-out-shipping').textContent).toBe('+$4.70');

    // Base handling: $3.00
    expect(document.getElementById('sim-out-handling').textContent).toBe('+$3.00');

    // Tax is 8.5% on (net sticker subtotal + shipping)
    expect(document.getElementById('sim-out-tax-label').textContent).toContain('8.5% OK');

    // Total and net should be populated with formatted currency strings
    expect(document.getElementById('sim-out-total').textContent).toMatch(/^\$\d+\.\d{2}$/);
    expect(document.getElementById('sim-out-net').textContent).toMatch(/^\$\d+\.\d{2}$/);
  });

  test('handles Local Pickup: free shipping, $3 pickup discount, and OK sales tax', () => {
    document.getElementById('sim-width').value = '3';
    document.getElementById('sim-height').value = '3';
    document.getElementById('sim-qty').value = '50';
    document.getElementById('sim-delivery').value = 'pickup';

    runSimulator();

    expect(document.getElementById('sim-out-ship-label').textContent).toContain('Local Pickup');
    expect(document.getElementById('sim-out-shipping').textContent).toContain('Pickup Disc');
    // Local pickup is subject to Oklahoma sales tax
    expect(document.getElementById('sim-out-tax-label').textContent).toContain('8.5% OK');
  });

  test('handles Out-of-State destination with 0% exempt sales tax', () => {
    document.getElementById('sim-width').value = '3';
    document.getElementById('sim-height').value = '3';
    document.getElementById('sim-qty').value = '50';
    document.getElementById('sim-delivery').value = 'ship';
    document.getElementById('sim-state').value = 'TX';

    runSimulator();

    expect(document.getElementById('sim-out-tax-label').textContent).toContain('Exempt');
    expect(document.getElementById('sim-out-tax').textContent).toBe('+$0.00');
  });

  test('handles Rush Turnaround (+20%) and Economy (-10%) modifiers', () => {
    document.getElementById('sim-width').value = '3';
    document.getElementById('sim-height').value = '3';
    document.getElementById('sim-qty').value = '50';
    document.getElementById('sim-delivery').value = 'ship';
    document.getElementById('sim-state').value = 'OTHER';

    // Standard
    document.getElementById('sim-tradeoffs').value = 'none';
    runSimulator();
    const standardSubtotal = parseFloat(document.getElementById('sim-out-subtotal').textContent.replace('$', ''));

    // Rush (+20%)
    document.getElementById('sim-tradeoffs').value = 'rush';
    runSimulator();
    const rushSubtotal = parseFloat(document.getElementById('sim-out-subtotal').textContent.replace('$', ''));
    expect(rushSubtotal).toBeCloseTo(standardSubtotal * 1.2, 1);

    // Economy (-10%)
    document.getElementById('sim-tradeoffs').value = 'eco';
    runSimulator();
    const ecoSubtotal = parseFloat(document.getElementById('sim-out-subtotal').textContent.replace('$', ''));
    expect(ecoSubtotal).toBeCloseTo(standardSubtotal * 0.9, 1);
  });

  test('renders Turnaround & Production Tradeoffs section in settings editor', () => {
    expect(document.getElementById('add-tradeoff-btn')).not.toBeNull();
    expect(document.getElementById('pricing-tradeoffs-list')).not.toBeNull();
    const rows = document.querySelectorAll('.tradeoff-row');
    expect(rows.length).toBeGreaterThan(0);

    // Verify rush and eco rows exist in editor
    const ids = Array.from(document.querySelectorAll('.tradeoff-id')).map(el => el.value);
    expect(ids).toContain('rush');
    expect(ids).toContain('eco');
  });

  test('dynamically adds custom turnaround option and updates simulator dropdown and calculation', () => {
    // Click add-tradeoff-btn
    document.getElementById('add-tradeoff-btn').click();

    const rows = document.querySelectorAll('.tradeoff-row');
    const newRow = rows[rows.length - 1];
    expect(newRow).not.toBeNull();

    // Customize the new row: Weekend Expedited (+50%)
    newRow.querySelector('.tradeoff-id').value = 'weekend_expedited';
    newRow.querySelector('.tradeoff-name').value = 'Weekend Expedited (+50%)';
    newRow.querySelector('.tradeoff-type').value = 'percentage';
    newRow.querySelector('.tradeoff-val').value = '50';

    // Trigger input event to simulate user typing
    newRow.querySelector('.tradeoff-val').dispatchEvent(new Event('input', { bubbles: true }));

    // Check that sim-tradeoffs select now contains the new option
    const tradeoffSelect = document.getElementById('sim-tradeoffs');
    const newOption = tradeoffSelect.querySelector('option[value="weekend_expedited"]');
    expect(newOption).not.toBeNull();
    expect(newOption.textContent).toContain('Weekend Expedited');

    // Select the new option and run simulator
    tradeoffSelect.value = 'weekend_expedited';
    runSimulator();

    // Baseline subtotal (0% tradeoff)
    tradeoffSelect.value = 'none';
    runSimulator();
    const baseSubtotal = parseFloat(document.getElementById('sim-out-subtotal').textContent.replace('$', ''));

    // 50% surcharge subtotal
    tradeoffSelect.value = 'weekend_expedited';
    runSimulator();
    const expeditedSubtotal = parseFloat(document.getElementById('sim-out-subtotal').textContent.replace('$', ''));
    expect(expeditedSubtotal).toBeCloseTo(baseSubtotal * 1.5, 1);
  });

  test('handles flat amount tradeoffs (e.g. -$10 Print-Ready Verification)', () => {
    const tradeoffSelect = document.getElementById('sim-tradeoffs');
    const printReadyOption = tradeoffSelect.querySelector('option[value="print_ready"]');
    expect(printReadyOption).not.toBeNull();

    // Baseline
    tradeoffSelect.value = 'none';
    runSimulator();
    const baseSubtotal = parseFloat(document.getElementById('sim-out-subtotal').textContent.replace('$', ''));

    // Print-ready (-$10)
    tradeoffSelect.value = 'print_ready';
    runSimulator();
    const printReadySubtotal = parseFloat(document.getElementById('sim-out-subtotal').textContent.replace('$', ''));
    expect(printReadySubtotal).toBeCloseTo(baseSubtotal - 10.00, 1);
  });
});
