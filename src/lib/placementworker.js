// /lib/placementworker.js
'use strict';

import { GeometryUtil } from './geometryutil.js';

export class PlacementWorker {
    constructor(bin, parts, ids, rotations, config, nfpCache) {
        this.binPolygon = bin;
        this.parts = parts;
        this.ids = ids;
        this.rotations = rotations;
        this.config = config;
        this.nfpCache = nfpCache;
    }

    placePaths(paths) {
        if (!paths || paths.length === 0) return null;

        const placements = [];
        const scale = 1000; // Precision scale for Clipper

        // Convert bin to Clipper path
        const binPath = this.toClipperPath(this.binPolygon, scale);

        // Track placed items for collision detection: { path, bounds }
        const placedItems = [];

        // Get bin bounds for scanning
        const binBounds = GeometryUtil.getPolygonBounds(this.binPolygon);

        // Bolt Optimization: Check if bin is effectively a rectangle.
        // If the bin area matches the bounding box area (within tolerance), it's a rectangle.
        // This allows us to skip the expensive Clipper check for "is part inside bin"
        // if the candidate bounding box is already within the bin bounding box (which the loop ensures).
        const binArea = Math.abs(GeometryUtil.polygonArea(this.binPolygon));
        const binBoundsArea = binBounds.width * binBounds.height;
        const isBinRect = Math.abs(binArea - binBoundsArea) < (binBoundsArea * 0.001);

        // Use a larger step for performance
        const step = this.config.spacing > 10 ? this.config.spacing : 20;

        // Bolt Optimization: Lift Clipper instantiation out of the loop.
        // We reuse these instances to avoid thousands of allocations/deallocations.
        const clipper = new window.ClipperLib.Clipper();
        const clipper2 = new window.ClipperLib.Clipper();
        const difference = new window.ClipperLib.Paths();
        const collision = new window.ClipperLib.Paths();

        for (let i = 0; i < paths.length; i++) {
            const part = paths[i];
            const id = this.ids[i];
            const rotation = this.rotations[i];

            // Bolt Optimization: Combine rotation, bounding box calculation, zeroing, and clipper conversion
            // into a single 2-pass O(N) operation to avoid creating intermediate O(N) arrays and objects.
            const { clipperPath: zeroedClipperPath, bounds: partBounds } = this.createRotatedZeroedClipperPath(part, rotation, scale);
            const candidateClipper = zeroedClipperPath.map(p => ({ X: p.X, Y: p.Y })); // Initial allocation

            let placed = false;
            let counter = 0;

            // Grid Search
            const potentialColliders = [];

            for (let y = binBounds.y; y < binBounds.y + binBounds.height; y += step) {
                // Optimization: Check if part fits vertically
                if (y + partBounds.height > binBounds.y + binBounds.height) continue;

                const startY = Math.round(y * scale);

                for (let x = binBounds.x; x < binBounds.x + binBounds.width; x += step) {
                    counter++;
                    // Optimization: Check if part fits horizontally
                    if (x + partBounds.width > binBounds.x + binBounds.width) continue;

                    // Update candidateClipper in-place with the current grid position
                    const startX = Math.round(x * scale);
                    for (let k = 0; k < zeroedClipperPath.length; k++) {
                        candidateClipper[k].X = zeroedClipperPath[k].X + startX;
                        candidateClipper[k].Y = zeroedClipperPath[k].Y + startY;
                    }

                    // Check 1: Is candidate inside bin?
                    // Bolt Optimization: Skip this check if bin is a rectangle (already checked by bounds).
                    if (!isBinRect) {
                        // Bolt Optimization: Use Clear() instead of new instance
                        clipper.Clear();
                        clipper.AddPath(candidateClipper, window.ClipperLib.PolyType.ptSubject, true);
                        clipper.AddPath(binPath, window.ClipperLib.PolyType.ptClip, true);

                        // Execute clears the output 'difference' array internally
                        clipper.Execute(window.ClipperLib.ClipType.ctDifference, difference, window.ClipperLib.PolyFillType.pftNonZero, window.ClipperLib.PolyFillType.pftNonZero);

                        let diffArea = 0;
                        for(let k=0; k<difference.length; k++) diffArea += Math.abs(window.ClipperLib.Clipper.Area(difference[k]));

                        if (diffArea > 1000) { // Tolerance (scaled)
                            continue;
                        }
                    }

                    // Check 2: Collision with other parts
                    // Bolt Optimization: Reuse potentialColliders array and inline collision check to avoid object creation in hot loop
                    potentialColliders.length = 0;
                    const pWidth = partBounds.width;
                    const pHeight = partBounds.height;

                    for (let k = 0; k < placedItems.length; k++) {
                        const itemBounds = placedItems[k].bounds;
                        // Inline intersect check: x < r2.x + r2.width && x + width > r2.x ...
                        if (x < itemBounds.x + itemBounds.width && x + pWidth > itemBounds.x &&
                            y < itemBounds.y + itemBounds.height && y + pHeight > itemBounds.y) {
                            potentialColliders.push(placedItems[k].path);
                        }
                    }

                    if (potentialColliders.length > 0) {
                        // Bolt Optimization: Use Clear()
                        clipper2.Clear();
                        clipper2.AddPath(candidateClipper, window.ClipperLib.PolyType.ptSubject, true);
                        clipper2.AddPaths(potentialColliders, window.ClipperLib.PolyType.ptClip, true);
                        clipper2.Execute(window.ClipperLib.ClipType.ctIntersection, collision, window.ClipperLib.PolyFillType.pftNonZero, window.ClipperLib.PolyFillType.pftNonZero);

                        let colArea = 0;
                        for(let k=0; k<collision.length; k++) colArea += Math.abs(window.ClipperLib.Clipper.Area(collision[k]));

                        if (colArea > 1000) {
                            continue; // Collision detected
                        }
                    }

                    // Valid placement!
                    placements.push({
                        x: x - partBounds.x,
                        y: y - partBounds.y,
                        id,
                        rotation
                    });

                    // Bolt Optimization: Must clone candidateClipper because we reuse the instance in the loop
                    const placedPath = candidateClipper.map(p => ({ X: p.X, Y: p.Y }));

                    // Bolt Optimization: Create candidateRect only on successful placement
                    const candidateRect = { x: x, y: y, width: partBounds.width, height: partBounds.height };
                    placedItems.push({ path: placedPath, bounds: candidateRect });
                    placed = true;
                    break;
                }
                if (placed) break;
            }

            if (!placed) {
                // console.warn(`PlacementWorker: Could not place part ${id}. Checked ${counter} positions.`);
            }
        }

        return {
            fitness: 0,
            placements: [placements]
        };
    }

    toClipperPath(polygon, scale) {
        return polygon.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));
    }

    // Bolt Optimization: Efficiently create the clipper path by combining operations
    createRotatedZeroedClipperPath(part, rotation, scale) {
        const angleRad = rotation * (Math.PI / 180);
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const len = part.length;

        // Pass 1: Calculate Bounds (in rotated space)
        // We do this to determine the offset needed to 'zero' the part (move to 0,0)
        for (let i = 0; i < len; i++) {
            const p = part[i];
            const rx = p.x * cos - p.y * sin;
            const ry = p.x * sin + p.y * cos;

            if (rx < minX) minX = rx;
            if (rx > maxX) maxX = rx;
            if (ry < minY) minY = ry;
            if (ry > maxY) maxY = ry;
        }

        const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        const clipperPath = new Array(len);

        // Pass 2: Create Clipper Path
        // Apply rotation, subtract minX/minY (zeroing), and scale to integer coordinates.
        for (let i = 0; i < len; i++) {
            const p = part[i];
            const rx = p.x * cos - p.y * sin;
            const ry = p.x * sin + p.y * cos;

            clipperPath[i] = {
                X: Math.round((rx - minX) * scale),
                Y: Math.round((ry - minY) * scale)
            };
        }

        return { clipperPath, bounds };
    }

    getBounds(placements) {
        if (!placements || placements.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        // Flatten the placements if it's a 2D array (list of bins)
        // In this implementation, placements is an array of placed parts [{x,y,id,rotation}, ...]
        // But placePaths returns { placements: [placements] }
        // The argument here seems to be the inner array of one bin?
        // Let's assume it's an array of part placements.

        placements.forEach(p => {
            const part = this.parts[p.id];
            const rotatedPart = GeometryUtil.rotatePolygon(part, p.rotation);
            const bounds = GeometryUtil.getPolygonBounds(rotatedPart);

            const partMinX = p.x + bounds.x;
            const partMinY = p.y + bounds.y;
            const partMaxX = p.x + bounds.x + bounds.width;
            const partMaxY = p.y + bounds.y + bounds.height;

            if (partMinX < minX) minX = partMinX;
            if (partMinY < minY) minY = partMinY;
            if (partMaxX > maxX) maxX = partMaxX;
            if (partMaxY > maxY) maxY = partMaxY;
        });

        if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };

        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
}
