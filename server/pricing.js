
function calculatePerimeter(polygons) {
    let totalPerimeter = 0;
    const distance = (p1, p2) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

    if (!Array.isArray(polygons)) return 0;

    polygons.forEach(poly => {
        if (!Array.isArray(poly) || poly.length < 2) return;
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length]; // Wrap around to the first point
            if (p1 && p2 && typeof p1.x === 'number' && typeof p1.y === 'number' && typeof p2.x === 'number' && typeof p2.y === 'number') {
                totalPerimeter += distance(p1, p2);
            }
        }
    });
    return totalPerimeter;
}

function calculateStickerPrice(pricingConfig, quantity, material, bounds, cutline, resolution) {
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

    if (pricingConfig.complexity && pricingConfig.complexity.tiers) {
        const sortedTiers = [...pricingConfig.complexity.tiers].sort((a,b) => (a.thresholdInches === 'Infinity' ? 1 : b.thresholdInches === 'Infinity' ? -1 : a.thresholdInches - b.thresholdInches));
        for (const tier of sortedTiers) {
            // Logic from client: perimeterInches <= tier.thresholdInches
            const threshold = tier.thresholdInches === 'Infinity' ? Infinity : tier.thresholdInches;
            if (perimeterInches <= threshold) {
                complexityMultiplier = tier.multiplier;
                break;
            }
        }
    }

    let discount = 0;
    if (pricingConfig.quantityDiscounts) {
        const sortedDiscounts = [...pricingConfig.quantityDiscounts].sort((a, b) => b.quantity - a.quantity);
        for (const tier of sortedDiscounts) {
            if (quantity >= tier.quantity) {
                discount = tier.discount;
                break;
            }
        }
    }

    const resolutionMultiplier = resolution.costMultiplier || 1.0;
    const totalCents = basePriceCents * quantity * materialMultiplier * complexityMultiplier * resolutionMultiplier;
    const discountedTotal = totalCents * (1 - discount);

    return {
        total: Math.round(discountedTotal),
        complexityMultiplier: complexityMultiplier
    };
}

import sizeOf from 'image-size';
import { parse } from 'svg-parser';
import { svgPathProperties } from 'svg-path-properties';
import fs from 'fs';
import { promisify } from 'util';
import { svgPathProperties } from "svg-path-properties";

function getPathPerimeter(pathNode) {
    let perimeter = 0;
    if (pathNode.properties && pathNode.properties.d) {
        const d = pathNode.properties.d;
        try {
            const properties = new svgPathProperties(d);
            perimeter = properties.getTotalLength();
        } catch (e) {
            console.warn('Failed to calculate path perimeter:', e);
            // Fallback or just return 0
        }
    }
    return perimeter;
}

async function getDesignDimensions(filePath) {
    const fileExtension = filePath.split('.').pop().toLowerCase();

    if (fileExtension === 'svg' || fileExtension === 'xml') {
        const svgText = await fs.promises.readFile(filePath, 'utf8');
        const parsed = parse(svgText);
        // svg-parser returns root structure, children[0] is usually the svg element
        const svgNode = parsed.children.find(child => child.tagName === 'svg');

        if (!svgNode) {
             throw new Error('Invalid SVG file');
        }

        const width = parseFloat(svgNode.properties.width);
        const height = parseFloat(svgNode.properties.height);

        let perimeter = 0;

        function traverse(node) {
            if(node.tagName === 'path') {
                perimeter += getPathPerimeter(node);
            }
            if (node.children && node.children.length > 0) {
                node.children.forEach(traverse);
            }
        }
        traverse(svgNode);

        // Construct a square polygon that has approximately this perimeter
        const side = perimeter / 4;
        const cutlinePolygon = [
            { x: 0, y: 0 },
            { x: side, y: 0 },
            { x: side, y: side },
            { x: 0, y: side }
        ];

        return {
            bounds: { width, height },
            cutline: [cutlinePolygon] // Array of polygons
        };

    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(fileExtension)) {
        const buffer = await fs.promises.readFile(filePath);
        const dimensions = sizeOf(buffer);
        // For image, cutline is the bounding box
        const cutlinePolygon = [
            { x: 0, y: 0 },
            { x: dimensions.width, y: 0 },
            { x: dimensions.width, y: dimensions.height },
            { x: 0, y: dimensions.height }
        ];
        return {
            bounds: { width: dimensions.width, height: dimensions.height },
            cutline: [cutlinePolygon]
        };
    } else {
        throw new Error(`Unsupported file type for dimension calculation: ${fileExtension}`);
    }
}

export { calculateStickerPrice, calculatePerimeter, getDesignDimensions };
