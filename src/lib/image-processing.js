// src/lib/image-processing.js

/**
 * Checks if an image has a transparent or white border.
 * @param {ImageData} imageData - The image data from canvas context.
 * @returns {boolean} - True if the border is transparent or white.
 */
// Bolt Optimization: Defined outside traceContour to avoid reallocation
const MOORE_NEIGHBORS = [
  { x: 1, y: 0 }, // 0: E
  { x: 1, y: -1 }, // 1: NE
  { x: 0, y: -1 }, // 2: N
  { x: -1, y: -1 }, // 3: NW
  { x: -1, y: 0 }, // 4: W
  { x: -1, y: 1 }, // 5: SW
  { x: 0, y: 1 }, // 6: S
  { x: 1, y: 1 }, // 7: SE
];

export function imageHasTransparentBorder(imageData) {
  const { data, width, height } = imageData;
  const borderSampleSize = 10; // Check this many pixels on each edge

  const isTransparentOrWhite = (i) => {
    if (data[i + 3] < 128) return true; // Alpha check
    if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) return true; // White check
    return false;
  };

  // Check top and bottom borders
  for (let x = 0; x < width; x += Math.floor(width / borderSampleSize)) {
    if (
      !isTransparentOrWhite((0 * width + x) * 4) ||
      !isTransparentOrWhite(((height - 1) * width + x) * 4)
    ) {
      return false;
    }
  }
  // Check left and right borders
  for (let y = 0; y < height; y += Math.floor(height / borderSampleSize)) {
    if (
      !isTransparentOrWhite((y * width + 0) * 4) ||
      !isTransparentOrWhite((y * width + (width - 1)) * 4)
    ) {
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

function detectBackgroundColor(imageData) {
  const { data, width, height } = imageData;
  const corners = [
    0, // Top-Left
    (width - 1) * 4, // Top-Right
    (height - 1) * width * 4, // Bottom-Left
    ((height - 1) * width + (width - 1)) * 4, // Bottom-Right
  ];

  let rSum = 0,
    gSum = 0,
    bSum = 0,
    validCount = 0;

  for (const i of corners) {
    if (data[i + 3] >= 128) {
      // Consider only opaque corners
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
      validCount++;
    }
  }

  if (validCount === 0) {
    // All corners are transparent, assume white background for fallback logic
    return { r: 255, g: 255, b: 255 };
  }

  return {
    r: Math.round(rSum / validCount),
    g: Math.round(gSum / validCount),
    b: Math.round(bSum / validCount),
  };
}

/**
 * Traces all contours of opaque parts of an image.
 * Uses Moore-Neighbor tracing algorithm with a full scan.
 * @param {ImageData} imageData - The image data.
 * @param {number} threshold - Tolerance for background color matching (0-255).
 * @returns {Array<Array<{x: number, y: number}>>} - Array of contours.
 */
export function traceContours(imageData, threshold = 10) {
  const { data, width, height } = imageData;
  let visited = new Uint8Array(width * height); // 0 = unvisited, 1 = visited
  let bgColor = detectBackgroundColor(imageData);

  // Bolt Optimization: Helper to check opacity by index directly to avoid bounds checks in tight loops
  const isOpaqueAtIndex = (i) => {
    // Check Alpha first
    if (data[i + 3] < 128) return false;

    // Only read RGB if alpha check passes and bgColor is set
    if (bgColor) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Check if pixel is close to background color
      const diff =
        Math.abs(r - bgColor.r) +
        Math.abs(g - bgColor.g) +
        Math.abs(b - bgColor.b);

      // If diff is within threshold * 3 (since we sum 3 channels), treat as transparent (background)
      if (diff <= threshold * 3) return false;
    }

    return true;
  };

  const isOpaque = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const i = (y * width + x) * 4;
    return isOpaqueAtIndex(i); // Reuse optimized check
  };

  const contours = [];

  const runTrace = () => {
    for (let y = 0; y < height; y++) {
      let prevOpaque = false; // Start of row (x=-1) is effectively transparent
      let rowOffset = y * width;

      for (let x = 0; x < width; x++) {
        const idx = rowOffset + x;

        // Skip if already part of a boundary
        if (visited[idx]) {
          prevOpaque = true; // Visited pixels are part of a contour, so they are opaque
          continue;
        }

        // Bolt Optimization: Use direct index access (safe here) and prevOpaque
        const pixelIndex = idx * 4;
        const currOpaque = isOpaqueAtIndex(pixelIndex);

        if (currOpaque) {
          // Only start tracing if we are at a "Left Edge" (enter opaque region from transparent)
          // If prevOpaque is false, it implies x=0 or pixel at x-1 was transparent/background
          if (!prevOpaque) {
            const contour = [];
            let cx = x;
            let cy = y;
            const startPos = { x, y };
            let lastDirection = 6; // Start checking from 6 (South)

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

        prevOpaque = currOpaque;
      }
    }
  };

  // First pass with detected background color
  runTrace();

  // If no contours found, retry without background color filtering
  // This handles full-bleed images where the content might match the detected "background" color (corners)
  if (contours.length === 0) {
    visited = new Uint8Array(width * height); // Reset visited
    bgColor = null; // Disable background color check
    runTrace();
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
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2),
    );
  }
  const numerator = Math.abs(
    dy * point.x -
      dx * point.y +
      lineEnd.x * lineStart.y -
      lineEnd.y * lineStart.x,
  );
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
    const isSinglePoint = denominator === 0;

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

export function getPolygonBounds(points) {
  if (!points || points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

export function isPointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function filterInternalContours(contours, minDimension) {
  // 1. Precompute bounds and area for efficiency
  const meta = contours.map((c, index) => {
    const bounds = getPolygonBounds(c);
    const area = getPolygonArea(c);
    return { index, contour: c, bounds, area };
  });

  // 2. Sort by area descending (largest first) to optimize nesting checks
  meta.sort((a, b) => b.area - a.area);

  const result = [];

  for (let i = 0; i < meta.length; i++) {
    const current = meta[i];
    let depth = 0;

    // Check against all larger contours
    for (let j = 0; j < i; j++) {
      const potentialParent = meta[j];
      // Quick check: Bounding box must contain
      if (
        current.bounds.minX >= potentialParent.bounds.minX &&
        current.bounds.maxX <= potentialParent.bounds.maxX &&
        current.bounds.minY >= potentialParent.bounds.minY &&
        current.bounds.maxY <= potentialParent.bounds.maxY
      ) {
        // Detailed check: Check first point
        if (isPointInPolygon(current.contour[0], potentialParent.contour)) {
          depth++;
        }
      }
    }

    // Even depth (0, 2...) = Solid/Island
    // Odd depth (1, 3...) = Hole
    const isHole = depth % 2 !== 0;

    if (isHole) {
      const maxDim = Math.max(current.bounds.width, current.bounds.height);
      // "Internal cuts... should be less than 2mm"
      // Filter: Remove holes that are LARGER than minDimension.
      // Keep holes that are SMALLER or EQUAL to minDimension.
      if (maxDim <= minDimension) {
        // Bolt Fix: Reverse hole contours so Clipper recognizes them as holes (opposite winding)
        result.push(current.contour.slice().reverse());
      }
    } else {
      // Always keep solids
      result.push(current.contour);
    }
  }

  return result;
}
