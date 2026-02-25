// tests/pricing.test.js

/**
 * @jest-environment jsdom
 */

import { calculateStickerPrice, generateSvgFromCutline } from '../src/lib/pricing.js';

// Define a test configuration that mirrors the production config structure
const pricingConfig = {
    "pricePerSquareInchCents": 15,
    "resolutions": [
        { "id": "dpi_96", "name": "96 DPI (Draft)", "ppi": 96, "costMultiplier": 1.0 },
        { "id": "dpi_300", "name": "300 DPI (Standard)", "ppi": 300, "costMultiplier": 1.3 }
    ],
    "materials": [
      { "id": "pp_standard", "name": "Standard Polypropylene", "costMultiplier": 1.0 },
      { "id": "pvc_laminated", "name": "Laminated PVC", "costMultiplier": 1.5 }
    ],
    "complexity": {
      "description": "Multiplier based on the perimeter of the cut path.",
      "tiers": [
        { "thresholdInches": 12, "multiplier": 1.0 },
        { "thresholdInches": 24, "multiplier": 1.1 },
        { "thresholdInches": "Infinity", "multiplier": 1.25 }
      ]
    },
    "quantityDiscounts": [
      { "quantity": 500, "discount": 0.15 },
      { "quantity": 200, "discount": 0.10 },
      { "quantity": 1, "discount": 0.0 }
    ]
};

describe('Sticker Pricing Calculation', () => {

    const draftResolution = pricingConfig.resolutions[0]; // 96 DPI, 1.0x cost
    const ppi = draftResolution.ppi;

    // A 3x3 inch square has a 12-inch perimeter.
    // The complexity tier threshold is 12. Since 12 <= 12, it falls into the 1.0 tier (Simplest).
    const simpleBounds = { width: 3 * ppi, height: 3 * ppi }; // 9 sq inches
    const simpleCutline = [[
        { x: 0, y: 0 },
        { x: 3 * ppi, y: 0 },
        { x: 3 * ppi, y: 3 * ppi },
        { x: 0, y: 3 * ppi }
    ]]; // 12 inch perimeter

    it('should calculate the base price correctly', () => {
        const quantity = 10;
        const material = 'pp_standard';
        const price = calculateStickerPrice(pricingConfig, quantity, material, simpleBounds, simpleCutline, draftResolution).total;

        // Expected: 9 sq.in * 15 cents/sq.in * 10 quantity * 1.0 material * 1.0 complexity * 1.0 resolution * 1.0 discount = 1350
        expect(price).toBe(1350);
    });

    it('should apply material cost multipliers', () => {
        const quantity = 10;
        const material = 'pvc_laminated'; // 1.5x multiplier
        const price = calculateStickerPrice(pricingConfig, quantity, material, simpleBounds, simpleCutline, draftResolution).total;

        // Expected: 1350 * 1.5 = 2025
        expect(price).toBe(2025);
    });

    it('should apply complexity multipliers', () => {
        const quantity = 10;
        const material = 'pp_standard';
        // A shape with a 25-inch perimeter
        const complexCutline = [[ { x: 0, y: 0 }, { x: 10 * ppi, y: 0 }, { x: 10 * ppi, y: 2.5 * ppi }, { x: 0, y: 2.5 * ppi } ]]; // Perimeter = 25 inches
        const complexBounds = { width: 10 * ppi, height: 2.5 * ppi }; // 25 sq inches
        // Perimeter is 25", which is > 24", so it falls into the "Infinity" tier with a 1.25 multiplier

        const priceResult = calculateStickerPrice(pricingConfig, quantity, material, complexBounds, complexCutline, draftResolution);

        // Expected: 25 sq.in * 15 cents * 10 quantity = 3750
        // Multiplier for 25" perimeter is 1.25
        // Expected: 3750 * 1.25 = 4687.5 -> 4688
        expect(priceResult.complexityMultiplier).toBe(1.25);
        expect(priceResult.total).toBe(4688);
    });

    it('should apply quantity discounts', () => {
        const quantity = 250; // Should trigger 10% discount
        const material = 'pp_standard';
        const price = calculateStickerPrice(pricingConfig, quantity, material, simpleBounds, simpleCutline, draftResolution).total;

        // Base total for 250: 9 * 15 * 250 * 1.0 (complexity) = 33750
        // Discount of 10%: 33750 * 0.9 = 30375
        expect(price).toBe(30375);

        const largeQuantity = 600; // Should trigger 15% discount
        const price2 = calculateStickerPrice(pricingConfig, largeQuantity, material, simpleBounds, simpleCutline, draftResolution).total;
        // Base total for 600: 9 * 15 * 600 * 1.0 (complexity) = 81000
        // Discount of 15%: 81000 * 0.85 = 68850
        expect(price2).toBe(68850);
    });

    it('should generate correct SVG from cutline', () => {
        const bounds = { left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 };
        const cutline = [[
            { x: 10, y: 10 },
            { x: 110, y: 10 },
            { x: 110, y: 110 },
            { x: 10, y: 110 }
        ]];

        const svg = generateSvgFromCutline(cutline, bounds);

        expect(svg).toContain('width="100"');
        expect(svg).toContain('height="100"');
        expect(svg).toContain('viewBox="0 0 100 100"');
        // Points should be shifted by (-10, -10)
        // (10,10) -> (0,0)
        // (110,10) -> (100,0)
        expect(svg).toContain('M 0 0');
        expect(svg).toContain('L 100 0');
        expect(svg).toContain('L 100 100');
        expect(svg).toContain('L 0 100');
    });
});
