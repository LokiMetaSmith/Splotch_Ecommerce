
export function calculatePerimeter(polygons) {
    let totalPerimeter = 0;
    const distance = (p1, p2) => {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    };

    polygons.forEach(poly => {
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length]; // Wrap around to the first point
            totalPerimeter += distance(p1, p2);
        }
    });
    return totalPerimeter;
}

export function calculateStickerPrice(pricingConfig, quantity, material, bounds, cutline, resolution, existingPerimeterPixels) {
    if (!pricingConfig) {
        console.error("Pricing config not loaded.");
        return { total: 0, complexityMultiplier: 1.0 };
    }
    if (quantity <= 0) return { total: 0, complexityMultiplier: 1.0 };
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return { total: 0, complexityMultiplier: 1.0 };
    if (!resolution) return { total: 0, complexityMultiplier: 1.0 };

    const ppi = resolution.ppi;
    const squareInches = (bounds.width / ppi) * (bounds.height / ppi);

    const basePriceCents = squareInches * pricingConfig.pricePerSquareInchCents;

    // Get material multiplier
    const materialInfo = pricingConfig.materials.find(m => m.id === material);
    const materialMultiplier = materialInfo ? materialInfo.costMultiplier : 1.0;

    // Get complexity multiplier
    const perimeterPixels = (typeof existingPerimeterPixels === 'number')
        ? existingPerimeterPixels
        : calculatePerimeter(cutline);
    const perimeterInches = perimeterPixels / ppi;
    let complexityMultiplier = 1.0;
    // Sort tiers ascending to find the first one the perimeter is less than.
    // Bolt Optimization: Tiers are pre-sorted on load. Iterating directly.
    for (const tier of pricingConfig.complexity.tiers) {
        // Find the first tier that the perimeter is less than or equal to.
        if (perimeterInches <= tier.thresholdInches) {
            complexityMultiplier = tier.multiplier;
            break;
        }
    }

    // Get quantity discount
    let discount = 0;
    // Bolt Optimization: Discounts are pre-sorted on load. Iterating directly.
    for (const tier of pricingConfig.quantityDiscounts) {
        if (quantity >= tier.quantity) {
            discount = tier.discount;
            break;
        }
    }

    const resolutionMultiplier = resolution.costMultiplier;
    const totalCents = basePriceCents * quantity * materialMultiplier * complexityMultiplier * resolutionMultiplier;
    const discountedTotal = totalCents * (1 - discount);

    return {
        total: Math.round(discountedTotal),
        complexityMultiplier: complexityMultiplier
    };
}

export function generateSvgFromCutline(cutline, bounds) {
    if (!cutline || cutline.length === 0 || !bounds) return null;

    const width = bounds.width;
    const height = bounds.height;

    let pathD = "";
    cutline.forEach((poly) => {
        if (poly.length === 0) return;
        pathD += `M ${poly[0].x - bounds.left} ${poly[0].y - bounds.top} `;
        for (let i = 1; i < poly.length; i++) {
            pathD += `L ${poly[i].x - bounds.left} ${poly[i].y - bounds.top} `;
        }
        pathD += "Z ";
    });

    return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <path d="${pathD.trim()}" fill="none" stroke="black" stroke-width="1" />
</svg>
    `.trim();
}
