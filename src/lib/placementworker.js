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

        // Use a larger step for performance
        const step = this.config.spacing > 10 ? this.config.spacing : 20;

        for (let i = 0; i < paths.length; i++) {
            const part = paths[i];
            const id = this.ids[i];
            const rotation = this.rotations[i];

            // Rotate part around (0,0)
            const rotatedPart = GeometryUtil.rotatePolygon(part, rotation);
            const partBounds = GeometryUtil.getPolygonBounds(rotatedPart);

            // Normalize part (top-left at 0,0)
            const zeroedPart = rotatedPart.map(p => ({ x: p.x - partBounds.x, y: p.y - partBounds.y }));

            let placed = false;
            let counter = 0;

            // Grid Search
            for (let y = binBounds.y; y < binBounds.y + binBounds.height; y += step) {
                // Optimization: Check if part fits vertically
                if (y + partBounds.height > binBounds.y + binBounds.height) continue;

                for (let x = binBounds.x; x < binBounds.x + binBounds.width; x += step) {
                    counter++;
                    // Optimization: Check if part fits horizontally
                    if (x + partBounds.width > binBounds.x + binBounds.width) continue;

                    // Construct candidate position (actual coordinates)
                    const candidatePart = zeroedPart.map(p => ({ x: p.x + x, y: p.y + y }));
                    const candidateClipper = this.toClipperPath(candidatePart, scale);

                    // Check 1: Is candidate inside bin?
                    const clipper = new window.ClipperLib.Clipper();
                    clipper.AddPath(candidateClipper, window.ClipperLib.PolyType.ptSubject, true);
                    clipper.AddPath(binPath, window.ClipperLib.PolyType.ptClip, true);
                    const difference = new window.ClipperLib.Paths();
                    clipper.Execute(window.ClipperLib.ClipType.ctDifference, difference, window.ClipperLib.PolyFillType.pftNonZero, window.ClipperLib.PolyFillType.pftNonZero);

                    let diffArea = 0;
                    for(let k=0; k<difference.length; k++) diffArea += Math.abs(window.ClipperLib.Clipper.Area(difference[k]));

                    if (diffArea > 1000) { // Tolerance (scaled)
                        continue;
                    }

                    // Check 2: Collision with other parts
                    // Optimization: Bounding Box Collision Check
                    const candidateRect = { x: x, y: y, width: partBounds.width, height: partBounds.height };
                    const potentialColliders = [];

                    for (let k = 0; k < placedItems.length; k++) {
                        if (GeometryUtil.rectsIntersect(candidateRect, placedItems[k].bounds)) {
                            potentialColliders.push(placedItems[k].path);
                        }
                    }

                    if (potentialColliders.length > 0) {
                        const clipper2 = new window.ClipperLib.Clipper();
                        clipper2.AddPath(candidateClipper, window.ClipperLib.PolyType.ptSubject, true);
                        clipper2.AddPaths(potentialColliders, window.ClipperLib.PolyType.ptClip, true);
                        const collision = new window.ClipperLib.Paths();
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

                    placedItems.push({ path: candidateClipper, bounds: candidateRect });
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
