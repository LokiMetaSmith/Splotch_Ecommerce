// src/lib/image-processing.js

/**
 * Checks if an image has a transparent or white border.
 * @param {ImageData} imageData - The image data from canvas context.
 * @returns {boolean} - True if the border is transparent or white.
 */
export function imageHasTransparentBorder(imageData) {
    const { data, width, height } = imageData;
    const borderSampleSize = 10; // Check this many pixels on each edge

    const isTransparentOrWhite = (i) => {
        if (data[i+3] < 128) return true; // Alpha check
        if (data[i] > 250 && data[i+1] > 250 && data[i+2] > 250) return true; // White check
        return false;
    };

    // Check top and bottom borders
    for (let x = 0; x < width; x += Math.floor(width / borderSampleSize)) {
        if (!isTransparentOrWhite((0 * width + x) * 4) || !isTransparentOrWhite(((height - 1) * width + x) * 4)) {
            return false;
        }
    }
    // Check left and right borders
    for (let y = 0; y < height; y += Math.floor(height / borderSampleSize)) {
        if (!isTransparentOrWhite((y * width + 0) * 4) || !isTransparentOrWhite((y * width + (width - 1)) * 4)) {
            return false;
        }
    }
    return true;
}

/**
 * Traces the contour of the opaque part of an image.
 * Uses Moore-Neighbor tracing algorithm.
 * @param {ImageData} imageData - The image data.
 * @returns {Array<{x: number, y: number}>|null} - The contour points or null if no start found.
 */
export function traceContour(imageData) {
    const { data, width, height } = imageData;

    // Bolt Optimization: Check alpha first to avoid unnecessary reads
    const isOpaque = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        const i = (y * width + x) * 4;

        // Check Alpha first
        const a = data[i+3];
        if (a < 128) return false;

        // Only read RGB if alpha check passes
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];

        // Treat pure white pixels as transparent
        if (r > 250 && g > 250 && b > 250) return false;

        return true; // Otherwise, pixel is opaque
    };

    // 1. Find the first non-transparent pixel
    // Bolt Optimization: Linear scan over the array is faster than nested x/y loops with coordinate calculation
    let startPos = null;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
        // Inline transparency check for speed in the scan loop
        const a = data[i+3];
        if (a < 128) continue;

        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];

        if (r > 250 && g > 250 && b > 250) continue;

        // Found it
        const pixelIndex = i / 4;
        startPos = {
            x: pixelIndex % width,
            y: Math.floor(pixelIndex / width)
        };
        break;
    }

    if (!startPos) {
        return null; // No opaque pixels found
    }

    const contour = [];
    let currentPos = startPos;
    let lastDirection = 6; // Start by checking the pixel to the left

    // Moore-Neighbor tracing algorithm
    const neighbors = [
        { x: 1, y: 0 },   // 0: E
        { x: 1, y: -1 },  // 1: NE
        { x: 0, y: -1 },  // 2: N
        { x: -1, y: -1 }, // 3: NW
        { x: -1, y: 0 },  // 4: W
        { x: -1, y: 1 },  // 5: SW
        { x: 0, y: 1 },   // 6: S
        { x: 1, y: 1 },   // 7: SE
    ];

    do {
        contour.push({ x: currentPos.x, y: currentPos.y });

        // Start checking neighbors from the one after the direction we came from
        let checkDirection = (lastDirection + 5) % 8;
        let nextPos = null;
        let foundNext = false;

        for (let i = 0; i < 8; i++) {
            const neighborOffset = neighbors[checkDirection];
            const neighborPos = { x: currentPos.x + neighborOffset.x, y: currentPos.y + neighborOffset.y };

            if (isOpaque(neighborPos.x, neighborPos.y)) {
                nextPos = neighborPos;
                lastDirection = checkDirection;
                foundNext = true;
                break;
            }
            checkDirection = (checkDirection + 1) % 8;
        }

        if (!foundNext) {
            // This can happen on a 1px line, we just stop.
            break;
        }

        currentPos = nextPos;

    } while (currentPos.x !== startPos.x || currentPos.y !== startPos.y);

    return contour;
}

export function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    if (dx === 0 && dy === 0) {
        return Math.sqrt(Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2));
    }
    const numerator = Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
    const denominator = Math.sqrt(dx * dx + dy * dy);
    return numerator / denominator;
}

// Bolt Optimization: Iterative implementation of RDP using a stack to avoid recursion and array slicing
function rdp(points, epsilon) {
    if (points.length < 3) return points;
    const len = points.length;

    // Bolt Optimization: Iterative implementation using a stack and Uint8Array marker
    // to avoid recursion depth limits and excessive array slicing/allocation.
    // Note: The upstream version also implemented an iterative approach, but we are keeping
    // our specific implementation logic (e.g., flattened stack) which we've verified.
    const keep = new Uint8Array(len);
    keep[0] = 1;
    keep[len - 1] = 1;

    const stack = [0, len - 1]; // Stack stores pairs of indices [start, end] flattened

    while (stack.length > 0) {
        const endIndex = stack.pop();
        const startIndex = stack.pop();

        let dmax = 0;
        let index = startIndex;
        const startPt = points[startIndex];
        const endPt = points[endIndex];

        // Bolt Optimization: Precompute line parameters
        const dx = endPt.x - startPt.x;
        const dy = endPt.y - startPt.y;
        const C = endPt.x * startPt.y - endPt.y * startPt.x;
        const denominator = Math.sqrt(dx * dx + dy * dy);
        const isSinglePoint = (denominator === 0);

        for (let i = startIndex + 1; i < endIndex; i++) {
            let d;
            if (isSinglePoint) {
                // Euclidean distance if line is a point
                d = Math.sqrt(Math.pow(points[i].x - startPt.x, 2) + Math.pow(points[i].y - startPt.y, 2));
            } else {
                // Perpendicular distance to line
                d = Math.abs(dy * points[i].x - dx * points[i].y + C) / denominator;
            }

            if (d > dmax) {
                index = i;
                dmax = d;
            }
        }

        if (dmax > epsilon) {
            keep[index] = 1;
            // Push right segment first so left is processed first (standard DFS order)
            stack.push(index, endIndex);
            stack.push(startIndex, index);
        }
    }

    // Reconstruct the path from marked points
    const result = [];
    for (let i = 0; i < len; i++) {
        if (keep[i]) result.push(points[i]);
    }
    return result;
}

export function simplifyPolygon(points, epsilon = 1.0) {
    if (points.length < 3) return points;
    return rdp(points, epsilon);
}
