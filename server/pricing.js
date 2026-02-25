function calculatePerimeter(polygons) {
    let totalPerimeter = 0;
    const distance = (p1, p2) => {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    };

    if (!Array.isArray(polygons)) return 0;

    polygons.forEach((poly) => {
        if (!Array.isArray(poly) || poly.length < 2) return;
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length]; // Wrap around to the first point
            if (
                p1 &&
                p2 &&
                typeof p1.x === "number" &&
                typeof p1.y === "number" &&
                typeof p2.x === "number" &&
                typeof p2.y === "number"
            ) {
                totalPerimeter += distance(p1, p2);
            }
        }
    });
    return totalPerimeter;
}

function calculateStickerPrice(
    pricingConfig,
    quantity,
    material,
    bounds,
    cutline,
    resolution,
) {
    if (!pricingConfig) {
        logger.error("Pricing config not loaded.");
        return { total: 0, complexityMultiplier: 1.0 };
    }
    if (quantity <= 0) return { total: 0, complexityMultiplier: 1.0 };
    if (!bounds || bounds.width <= 0 || bounds.height <= 0)
        return { total: 0, complexityMultiplier: 1.0 };
    if (!resolution) return { total: 0, complexityMultiplier: 1.0 };

    const ppi = resolution.ppi;
    const squareInches = (bounds.width / ppi) * (bounds.height / ppi);

    const basePriceCents = squareInches * pricingConfig.pricePerSquareInchCents;

    const materialInfo = pricingConfig.materials.find((m) => m.id === material);
    const materialMultiplier = materialInfo ? materialInfo.costMultiplier : 1.0;

    const perimeterPixels = calculatePerimeter(cutline);
    const perimeterInches = perimeterPixels / ppi;
    let complexityMultiplier = 1.0;

    if (pricingConfig.complexity && pricingConfig.complexity.tiers) {
        // Bolt Optimization: Tiers are pre-sorted on load. Iterating directly.
        for (const tier of pricingConfig.complexity.tiers) {
            // Logic from client: perimeterInches <= tier.thresholdInches
            const threshold =
                tier.thresholdInches === "Infinity" ? Infinity : tier.thresholdInches;
            if (perimeterInches <= threshold) {
                complexityMultiplier = tier.multiplier;
                break;
            }
        }
    }

    let discount = 0;
    if (pricingConfig.quantityDiscounts) {
        // Bolt Optimization: Discounts are pre-sorted on load. Iterating directly.
        for (const tier of pricingConfig.quantityDiscounts) {
            if (quantity >= tier.quantity) {
                discount = tier.discount;
                break;
            }
        }
    }

    const resolutionMultiplier = resolution.costMultiplier || 1.0;
    const totalCents =
        basePriceCents *
        quantity *
        materialMultiplier *
        complexityMultiplier *
        resolutionMultiplier;
    const discountedTotal = totalCents * (1 - discount);

    return {
        total: Math.round(discountedTotal),
        complexityMultiplier: complexityMultiplier,
    };
}

import sizeOf from "image-size";
import { parse } from "svg-parser";
import { svgPathProperties } from "svg-path-properties";
import fs from "fs";
import { promisify } from "util";
import logger from "./logger.js";

function getPathPerimeter(pathNode) {
    let perimeter = 0;
    if (pathNode.properties && pathNode.properties.d) {
        try {
            const properties = new svgPathProperties(pathNode.properties.d);
            perimeter = properties.getTotalLength();
        } catch (e) {
            logger.error("Error calculating path length:", e);
        }
    }
    return perimeter;
}

async function getDesignDimensions(filePath) {
    const fileExtension = filePath.split(".").pop().toLowerCase();

    if (fileExtension === "svg" || fileExtension === "xml") {
        const svgText = await fs.promises.readFile(filePath, "utf8");
        const parsed = parse(svgText);
        // svg-parser returns root structure, children[0] is usually the svg element
        const svgNode = parsed.children.find((child) => child.tagName === "svg");

        if (!svgNode) {
            throw new Error("Invalid SVG file");
        }

        const width = parseFloat(svgNode.properties.width);
        const height = parseFloat(svgNode.properties.height);

        let perimeter = 0;

        // Iterative traversal to avoid stack overflow
        const stack = [svgNode];
        let processedNodes = 0;
        const MAX_NODES = 500000; // Limit to prevent DoS via CPU exhaustion

        while (stack.length > 0) {
            const node = stack.pop();
            processedNodes++;
            if (processedNodes > MAX_NODES) {
                throw new Error("SVG complexity exceeds maximum limit.");
            }

            if (node.tagName === "path") {
                perimeter += getPathPerimeter(node);
            } else if (node.tagName === "rect") {
                const w = parseFloat(node.properties.width || 0);
                const h = parseFloat(node.properties.height || 0);
                perimeter += 2 * (w + h);
            } else if (node.tagName === "circle") {
                const r = parseFloat(node.properties.r || 0);
                perimeter += 2 * Math.PI * r;
            } else if (node.tagName === "ellipse") {
                const rx = parseFloat(node.properties.rx || 0);
                const ry = parseFloat(node.properties.ry || 0);
                // Approximation: 2 * PI * sqrt((rx^2 + ry^2) / 2)
                perimeter += 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
            } else if (node.tagName === "polygon" || node.tagName === "polyline") {
                const pointsStr = node.properties.points || "";
                // Simple splitting by comma or whitespace
                const points = pointsStr
                    .trim()
                    .split(/[\s,]+/)
                    .map(Number)
                    .filter((n) => !isNaN(n));

                // Ensure even number of points (pairs of x,y)
                if (points.length % 2 !== 0) {
                    points.pop();
                }

                if (points.length >= 4) {
                    for (let i = 0; i < points.length; i += 2) {
                        const x1 = points[i];
                        const y1 = points[i + 1];

                        let x2, y2;
                        if (i + 2 < points.length) {
                            x2 = points[i + 2];
                            y2 = points[i + 3];
                        } else {
                            // Last point
                            if (node.tagName === "polygon") {
                                // Close the loop to first point
                                x2 = points[0];
                                y2 = points[1];
                            } else {
                                // Polyline does not close
                                continue;
                            }
                        }
                        const dx = x2 - x1;
                        const dy = y2 - y1;
                        perimeter += Math.sqrt(dx * dx + dy * dy);
                    }
                }
            }

            if (node.children && node.children.length > 0) {
                // Push children to stack
                for (const child of node.children) {
                    stack.push(child);
                }
            }
        }

        // Construct a square polygon that has approximately this perimeter
        const side = perimeter / 4;
        const cutlinePolygon = [
            { x: 0, y: 0 },
            { x: side, y: 0 },
            { x: side, y: side },
            { x: 0, y: side },
        ];

        return {
            bounds: { width, height },
            cutline: [cutlinePolygon], // Array of polygons
        };
    } else if (
        ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(fileExtension)
    ) {
        const buffer = await fs.promises.readFile(filePath);
        const dimensions = sizeOf(buffer);
        // For image, cutline is the bounding box
        const cutlinePolygon = [
            { x: 0, y: 0 },
            { x: dimensions.width, y: 0 },
            { x: dimensions.width, y: dimensions.height },
            { x: 0, y: dimensions.height },
        ];
        return {
            bounds: { width: dimensions.width, height: dimensions.height },
            cutline: [cutlinePolygon],
        };
    } else {
        throw new Error(
            `Unsupported file type for dimension calculation: ${fileExtension}`,
        );
    }
}

export { calculateStickerPrice, calculatePerimeter, getDesignDimensions };
