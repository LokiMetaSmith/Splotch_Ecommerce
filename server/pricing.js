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

function calculateStickerPrice(quantity, material, bounds, cutline, resolution, pricingConfig) {
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

    const materialInfo = pricingConfig.materials.find(m => m.id === material);
    const materialMultiplier = materialInfo ? materialInfo.costMultiplier : 1.0;

    const perimeterPixels = calculatePerimeter(cutline);
    const perimeterInches = perimeterPixels / ppi;
    let complexityMultiplier = 1.0;
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

    const resolutionMultiplier = resolution.costMultiplier;
    const totalCents = basePriceCents * quantity * materialMultiplier * complexityMultiplier * resolutionMultiplier;
    const discountedTotal = totalCents * (1 - discount);

    return {
        total: Math.round(discountedTotal),
        complexityMultiplier: complexityMultiplier
    };
}

import sizeOf from 'image-size';
import { parse } from 'svg-parser';
import fs from 'fs';

function getPathPerimeter(pathNode) {
    // This is a simplified perimeter calculation for server-side.
    // It assumes straight line segments in the 'd' attribute.
    // A full implementation would need to handle curves (C, S, Q, T, A).
    let perimeter = 0;
    if (pathNode.properties && pathNode.properties.d) {
        const d = pathNode.properties.d;
        // This regex is a simplification and may not cover all cases.
        const points = (d.match(/[MLHVCSQTAZ][^MLHVCSQTAZ]*/ig) || [])
            .map(cmd => {
                const points = cmd.slice(1).trim().split(/[\s,]+/);
                return { x: parseFloat(points[0]), y: parseFloat(points[1]) };
            });

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i+1];
            if(p1.x && p1.y && p2.x && p2.y) {
                 perimeter += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
            }
        }
    }
    return perimeter;
}

async function getDesignDimensions(filePath) {
    const fileExtension = filePath.split('.').pop().toLowerCase();

    if (fileExtension === 'svg') {
        const svgText = fs.readFileSync(filePath, 'utf8');
        const parsed = parse(svgText);
        const svgNode = parsed.children[0];
        const width = parseFloat(svgNode.properties.width);
        const height = parseFloat(svgNode.properties.height);

        let perimeter = 0;
        // A simple perimeter calculation for server-side.
        function traverse(node) {
            if(node.tagName === 'path') {
                perimeter += getPathPerimeter(node);
            }
            if (node.children && node.children.length > 0) {
                node.children.forEach(traverse);
            }
        }
        traverse(svgNode);

        return {
            bounds: { width, height },
            // Create a mock cutline for perimeter calculation.
            // A more robust solution would re-implement the client's logic here.
            cutline: [{ length: perimeter }]
        };

    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(fileExtension)) {
        const dimensions = sizeOf(filePath);
        const perimeter = (dimensions.width + dimensions.height) * 2;
        return {
            bounds: { width: dimensions.width, height: dimensions.height },
            cutline: [{ length: perimeter }]
        };
    } else {
        throw new Error(`Unsupported file type for dimension calculation: ${fileExtension}`);
    }
}

export { calculateStickerPrice, calculatePerimeter, getDesignDimensions };
