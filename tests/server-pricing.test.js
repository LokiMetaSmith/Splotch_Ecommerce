import { describe, it, expect } from '@jest/globals';
import { calculateStickerPrice } from '../server/pricing.js';

// Mock pricing configuration for consistent testing
const mockPricingConfig = {
  pricePerSquareInchCents: 10, // 10 cents per sq inch
  materials: [
    { id: 'standard', costMultiplier: 1.0 },
    { id: 'premium', costMultiplier: 1.5 },
  ],
  complexity: {
    tiers: [
      { thresholdInches: 10, multiplier: 1.0 },
      { thresholdInches: 20, multiplier: 1.2 },
      { thresholdInches: 'Infinity', multiplier: 1.5 },
    ],
  },
  quantityDiscounts: [
    { quantity: 50, discount: 0.05 }, // 5% off for 50+
    { quantity: 100, discount: 0.1 }, // 10% off for 100+
  ],
  resolutions: [
    { id: 'dpi_150', ppi: 150, costMultiplier: 1.0 },
    { id: 'dpi_300', ppi: 300, costMultiplier: 1.2 },
  ],
};

describe('calculateStickerPrice', () => {
  const resolution = mockPricingConfig.resolutions[0]; // 150 PPI

  it('should calculate a basic price correctly', () => {
    const quantity = 10;
    const material = 'standard';
    // 300x300 pixels at 150 PPI = 2x2 inches = 4 sq inches
    const bounds = { width: 300, height: 300 };
    // Simple rectangle perimeter = (2+2)*2 = 8 inches. Below complexity threshold.
    const cutline = [[{x: 0, y: 0}, {x: 300, y: 0}, {x: 300, y: 300}, {x: 0, y: 300}]];

    // Calculation:
    // Base price = 4 sq in * 10 cents/sqin = 40 cents
    // Total for quantity = 40 * 10 = 400 cents
    // Multipliers (material, complexity, resolution) = 1.0
    // Discount = 0%
    // Final = 400 cents
    const { total } = calculateStickerPrice(quantity, material, bounds, cutline, resolution, mockPricingConfig);
    expect(total).toBe(400);
  });

  it('should apply material cost multiplier', () => {
    const quantity = 10;
    const material = 'premium'; // 1.5x multiplier
    const bounds = { width: 300, height: 300 }; // 4 sq in
    const cutline = [[{x: 0, y: 0}, {x: 300, y: 0}, {x: 300, y: 300}, {x: 0, y: 300}]];

    // Calculation: 400 cents * 1.5 (material) = 600 cents
    const { total } = calculateStickerPrice(quantity, material, bounds, cutline, resolution, mockPricingConfig);
    expect(total).toBe(600);
  });

  it('should apply complexity multiplier for long perimeters', () => {
    const quantity = 10;
    const material = 'standard';
    const bounds = { width: 300, height: 300 }; // 4 sq in
    // A 562x562 pixel rectangle at 150 PPI has a perimeter of ~15 inches.
    // (562*4) / 150 = 14.98 inches. This should fall into the 1.2x multiplier tier.
    const cutline = [[{x: 0, y: 0}, {x: 562, y: 0}, {x: 562, y: 562}, {x: 0, y: 562}]];

    // Calculation: 400 cents * 1.2 (complexity) = 480 cents
    const { total } = calculateStickerPrice(quantity, material, bounds, cutline, resolution, mockPricingConfig);
    expect(total).toBe(480);
  });

  it('should apply quantity discounts', () => {
    const quantity = 50; // 5% discount
    const material = 'standard';
    const bounds = { width: 300, height: 300 }; // 4 sq in
    const cutline = [[{x: 0, y: 0}, {x: 300, y: 0}, {x: 300, y: 300}, {x: 0, y: 300}]];

    // Calculation:
    // Base price = 4 sq in * 10 cents/sqin = 40 cents
    // Total for quantity = 40 * 50 = 2000 cents
    // Discount = 2000 * 0.05 = 100 cents
    // Final = 2000 - 100 = 1900 cents
    const { total } = calculateStickerPrice(quantity, material, bounds, cutline, resolution, mockPricingConfig);
    expect(total).toBe(1900);
  });

  it('should apply resolution multiplier', () => {
    const quantity = 10;
    const material = 'standard';
    const bounds = { width: 300, height: 300 }; // 4 sq in
    const cutline = [[{x: 0, y: 0}, {x: 300, y: 0}, {x: 300, y: 300}, {x: 0, y: 300}]];
    const highRes = mockPricingConfig.resolutions[1]; // 300 PPI, 1.2x multiplier

    // Calculation at 300 PPI:
    // Bounds are now 1x1 inches = 1 sq in
    // Base price = 1 * 10 = 10 cents
    // Total for quantity = 10 * 10 = 100 cents
    // Resolution multiplier = 1.2
    // Final = 100 * 1.2 = 120 cents
    const { total } = calculateStickerPrice(quantity, material, bounds, cutline, highRes, mockPricingConfig);
    expect(total).toBe(120);
  });

  it('should return 0 for invalid inputs', () => {
    const bounds = { width: 300, height: 300 };
    const cutline = [[{x: 0, y: 0}]];

    expect(calculateStickerPrice(0, 'standard', bounds, cutline, resolution, mockPricingConfig).total).toBe(0);
    expect(calculateStickerPrice(10, 'standard', {width: 0, height: 0}, cutline, resolution, mockPricingConfig).total).toBe(0);
    expect(calculateStickerPrice(10, 'standard', bounds, cutline, null, mockPricingConfig).total).toBe(0);
    expect(calculateStickerPrice(10, 'standard', bounds, cutline, resolution, null).total).toBe(0);
  });
});
