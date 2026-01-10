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

        // Track placed paths for collision detection
        const placedPaths = new window.ClipperLib.Paths();

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
                    if (placedPaths.length > 0) {
                        const clipper2 = new window.ClipperLib.Clipper();
                        clipper2.AddPath(candidateClipper, window.ClipperLib.PolyType.ptSubject, true);
                        clipper2.AddPaths(placedPaths, window.ClipperLib.PolyType.ptClip, true);
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

                    placedPaths.push(candidateClipper);
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
         return { x: 0, y: 0, width: 0, height: 0 };
    }
}
