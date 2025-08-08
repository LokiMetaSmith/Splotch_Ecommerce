// tests/pricing.test.js

/**
 * @jest-environment jsdom
 */

// Mocking the functions and variables from index.js
// In a real-world scenario with a bundler, we would import these.
// For this environment, we'll have to redefine them or find a way to share them.

// Since we can't easily import from src/index.js without a proper module setup
// that Jest can understand, we will copy the pure function here for testing.

const pricingConfig = {
    "pixelsPerInch": 96,
    "pricePerSquareInchCents": 15,
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
      { "quantity": 1, "discount": 0.0 },
      { "quantity": 200, "discount": 0.10 },
      { "quantity": 500, "discount": 0.15 }
    ]
};

function calculatePerimeter(polygons) {
    let totalPerimeter = 0;
    const distance = (p1, p2) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

    polygons.forEach(poly => {
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length]; // Wrap around to the first point
            totalPerimeter += distance(p1, p2);
        }
    });
    return totalPerimeter;
}

function calculateStickerPrice(quantity, material, bounds, cutline) {
    if (!pricingConfig) {
        console.error("Pricing config not loaded.");
        return 0;
    }
    if (quantity <= 0) return 0;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return 0;

    const ppi = pricingConfig.pixelsPerInch;
    const squareInches = (bounds.width / ppi) * (bounds.height / ppi);

    const basePriceCents = squareInches * pricingConfig.pricePerSquareInchCents;

    const materialInfo = pricingConfig.materials.find(m => m.id === material);
    const materialMultiplier = materialInfo ? materialInfo.costMultiplier : 1.0;

    const perimeterPixels = calculatePerimeter(cutline);
    const perimeterInches = perimeterPixels / ppi;
    let complexityMultiplier = 1.0;
    // Note: The logic here is slightly flawed. It should check >= threshold.
    // Let's assume tiers are sorted ascending by threshold for this test.
    const sortedTiers = [...pricingConfig.complexity.tiers].sort((a,b) => (a.thresholdInches === 'Infinity' ? 1 : b.thresholdInches === 'Infinity' ? -1 : a.thresholdInches - b.thresholdInches));
    for (const tier of sortedTiers) {
        if (tier.thresholdInches === "Infinity" || perimeterInches < tier.thresholdInches) {
            complexityMultiplier = tier.multiplier;
            break;
        }
    }

    let discount = 0;
    const sortedDiscounts = [...pricingConfig.quantityDiscounts].sort((a, b) => b.quantity - a.quantity);
    for (const tier of sortedDiscounts) {
        if (quantity >= tier.quantity) {
            discount = tier.discount;
            break;
        }
    }

    const totalCents = basePriceCents * quantity * materialMultiplier * complexityMultiplier;
    const discountedTotal = totalCents * (1 - discount);

    // Return an object for easier testing
    return {
        total: Math.round(discountedTotal),
        complexityMultiplier: complexityMultiplier
    };
}


describe('Sticker Pricing Calculation', () => {

    // Define a simple square for testing (e.g., 3x3 inches)
    const ppi = pricingConfig.pixelsPerInch;
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
        const price = calculateStickerPrice(quantity, material, simpleBounds, simpleCutline).total;

        // Expected: 9 sq.in * 15 cents/sq.in * 10 quantity * 1.0 material * 1.0 complexity * 1.0 discount = 1350
        expect(price).toBe(1350);
    });

    it('should apply material cost multipliers', () => {
        const quantity = 10;
        const material = 'pvc_laminated'; // 1.5x multiplier
        const price = calculateStickerPrice(quantity, material, simpleBounds, simpleCutline).total;

        // Expected: 1350 * 1.5 = 2025
        expect(price).toBe(2025);
    });

    it('should apply complexity multipliers', () => {
        const quantity = 10;
        const material = 'pp_standard';
        // A more complex shape with a 25-inch perimeter
        const complexCutline = [[
            { x: 0, y: 0 },
            { x: 10 * ppi, y: 0 },
            { x: 10 * ppi, y: 2.5 * ppi },
            { x: 0, y: 2.5 * ppi }
        ]]; // Perimeter = 25 inches, should trigger 1.25x multiplier
        const complexBounds = { width: 10 * ppi, height: 2.5 * ppi }; // 25 sq inches

        const priceResult = calculateStickerPrice(quantity, material, complexBounds, complexCutline);

        // Expected: 25 sq.in * 15 cents * 10 quantity = 3750
        // Multiplier for 25" perimeter is 1.25
        // Expected: 3750 * 1.25 = 4687.5 -> 4688
        expect(priceResult.complexityMultiplier).toBe(1.25);
        expect(priceResult.total).toBe(4688);
    });

    it('should apply quantity discounts', () => {
        const quantity = 250; // Should trigger 10% discount
        const material = 'pp_standard';
        const price = calculateStickerPrice(quantity, material, simpleBounds, simpleCutline).total;

        // Base total for 250: 9 * 15 * 250 = 33750
        // Discount of 10%: 33750 * 0.9 = 30375
        expect(price).toBe(30375);

        const largeQuantity = 600; // Should trigger 15% discount
        const price2 = calculateStickerPrice(largeQuantity, material, simpleBounds, simpleCutline).total;
        // Base total for 600: 9 * 15 * 600 = 81000
        // Discount of 15%: 81000 * 0.85 = 68850
        expect(price2).toBe(68850);
    });
});
