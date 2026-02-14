// src/lib/image-processing.js

/**
 * Checks if an image has a transparent or white border.
 * @param {ImageData} imageData - The image data from canvas context.
 * @returns {boolean} - True if the border is transparent or white.
 */
// Bolt Optimization: Defined outside traceContour to avoid reallocation
const MOORE_NEIGHBORS = [
    { x: 1, y: 0 },   // 0: E
    { x: 1, y: -1 },  // 1: NE
    { x: 0, y: -1 },  // 2: N
    { x: -1, y: -1 }, // 3: NW
    { x: -1, y: 0 },  // 4: W
    { x: -1, y: 1 },  // 5: SW
    { x: 0, y: 1 },   // 6: S
    { x: 1, y: 1 },   // 7: SE
];

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

export function getPolygonArea(points) {
    let area = 0;
    const len = points.length;
    for (let i = 0; i < len; i++) {
        const j = (i + 1) % len;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area / 2);
}

/**
 * Traces all contours of opaque parts of an image.
 * Uses Moore-Neighbor tracing algorithm with a full scan.
 * @param {ImageData} imageData - The image data.
 * @returns {Array<Array<{x: number, y: number}>>} - Array of contours.
 */
export function traceContours(imageData) {
    const { data, width, height } = imageData;
    const visited = new Uint8Array(width * height); // 0 = unvisited, 1 = visited

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

    const contours = [];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;

            // Skip if already part of a boundary
            if (visited[idx]) continue;

            if (isOpaque(x, y)) {
                // Only start tracing if we are at a "Left Edge" (enter opaque region from transparent)
                // This prevents starting traces inside a solid body or on the right edge of a hole (if we don't care about holes)
                // Actually, this logic correctly identifies the start of an outer boundary or a hole boundary.
                if (x === 0 || !isOpaque(x - 1, y)) {

                    const contour = [];
                    let cx = x;
                    let cy = y;
                    const startPos = { x, y };
                    let lastDirection = 6; // Start checking from 6 (South) assuming we entered from West?
                    // Standard Moore enters from "Backwards".
                    // If we scan L->R, we enter (x,y) from (x-1,y). So Backtrack is West (4).
                    // We start checking clockwise from Backtrack? Or Counter-Clockwise?
                    // Moore usually checks B starting from B's neighbor.
                    // Let's stick to the previous implementation's direction logic if it worked,
                    // or use standard: Start search from (entering direction - 1 or + 1).
                    // Previous code: lastDirection = 6.

                    let foundNext = false;

                    do {
                        contour.push({ x: cx, y: cy });
                        visited[cy * width + cx] = 1;

                        // Start checking neighbors from the one after the direction we came from
                        let checkDirection = (lastDirection + 5) % 8;
                        foundNext = false;

                        for (let i = 0; i < 8; i++) {
                            const neighborOffset = MOORE_NEIGHBORS[checkDirection];
                            const nx = cx + neighborOffset.x;
                            const ny = cy + neighborOffset.y;

                            if (isOpaque(nx, ny)) {
                                cx = nx;
                                cy = ny;
                                lastDirection = checkDirection;
                                foundNext = true;
                                break;
                            }
                            checkDirection = (checkDirection + 1) % 8;
                        }

                        if (!foundNext) {
                            break;
                        }

                    } while (cx !== startPos.x || cy !== startPos.y);

                    if (contour.length > 2) {
                        contours.push(contour);
                    }
                }
            }
        }
    }

    return contours;
}

/**
 * Traces the contour of the opaque part of an image.
 * Legacy wrapper: Returns the LARGEST contour found to avoid noise.
 * @param {ImageData} imageData - The image data.
 * @returns {Array<{x: number, y: number}>|null} - The contour points or null.
 */
export function traceContour(imageData) {
    const contours = traceContours(imageData);
    if (!contours || contours.length === 0) return null;

    let maxArea = -1;
    let largest = null;

    for (const c of contours) {
        const area = getPolygonArea(c);
        if (area > maxArea) {
            maxArea = area;
            largest = c;
        }
    }

    return largest;
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
    const len = points.length;
    if (len < 3) return points;

    // Bolt Optimization: Iterative approach using a stack to avoid recursion depth limits and array allocations
    // Use Uint8Array to mark points to keep (1) or discard (0).
    const keep = new Uint8Array(len);
    keep[0] = 1;
    keep[len - 1] = 1;

    const stack = [0, len - 1];

    while (stack.length > 0) {
        const end = stack.pop();
        const start = stack.pop();

        let dmax = 0;
        let index = 0;
        const startPt = points[start];
        const endPt = points[end];

        // Precompute line parameters
        const dx = endPt.x - startPt.x;
        const dy = endPt.y - startPt.y;
        const C = endPt.x * startPt.y - endPt.y * startPt.x;
        const denominator = Math.sqrt(dx * dx + dy * dy);
        const isSinglePoint = (denominator === 0);

        // Bolt Optimization: Minimize operations in the hot loop
        // 1. Avoid Math.sqrt inside the loop (use squared distance).
        // 2. Avoid division inside the loop (compare numerators).
        // 3. Cache points[i] to avoid repeated array access.
        if (isSinglePoint) {
            let maxDistSq = 0;
            const sx = startPt.x; // Cache property access
            const sy = startPt.y;
            for (let i = start + 1; i < end; i++) {
                const p = points[i];
                const dx_i = p.x - sx;
                const dy_i = p.y - sy;
                const dSq = dx_i * dx_i + dy_i * dy_i;
                if (dSq > maxDistSq) {
                    index = i;
                    maxDistSq = dSq;
                }
            }
            dmax = Math.sqrt(maxDistSq);
        } else {
            let maxNumerator = 0;
            for (let i = start + 1; i < end; i++) {
                const p = points[i];
                const numerator = Math.abs(dy * p.x - dx * p.y + C);
                if (numerator > maxNumerator) {
                    index = i;
                    maxNumerator = numerator;
                }
            }
            dmax = maxNumerator / denominator;
        }

        if (dmax > epsilon) {
            keep[index] = 1;
            // Push sub-segments to stack
            stack.push(start, index);
            stack.push(index, end);
        }
    }

    const result = [];
    for (let i = 0; i < len; i++) {
        if (keep[i]) {
            result.push(points[i]);
        }
    }
    return result;
}

export function simplifyPolygon(points, epsilon = 1.0) {
    if (points.length < 3) return points;
    return rdp(points, epsilon);
}
