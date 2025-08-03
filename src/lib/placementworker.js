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
        if (!paths || paths.length === 0) {
            return null;
        }

        const placements = [];
        let fitness = 0;
        let placedArea = 0;
        const binArea = Math.abs(GeometryUtil.polygonArea(this.binPolygon));
        const self = this;

        // A list of all possible placement positions
        const allplacements = [];

        for (let i = 0; i < paths.length; i++) {
            const part = paths[i];
            const id = this.ids[i];
            const rotation = this.rotations[i];
            const partData = this.parts[id];
            partData.rotation = rotation;
            partData.id = id;

            let position = null;
            if (placements.length === 0) {
                // First part is always placed at 0,0
                for (let j = 0; j < partData.length; j++) {
                    partData[j].x -= partData[0].x;
                    partData[j].y -= partData[0].y;
                }
                position = { x: 0, y: 0, id, rotation };
            } else {
                let minwidth = -1;
                let minarea = -1;
                let best_placement = null;
                const placed = placements.map(p => this.parts[p.id]);

                const key = { A: this.binPolygon.id, B: id, inside: true, Arotation: 0, Brotation: rotation };
                const binNfp = this.nfpCache[JSON.stringify(key)];

                if (!binNfp || binNfp.length === 0) {
                    continue; // Part cannot fit in bin
                }

                const allNfps = [];
                for (const p of placements) {
                    const placedPart = this.parts[p.id];
                    const key = { A: placedPart.id, B: id, inside: false, Arotation: p.rotation, Brotation: rotation };
                    const nfp = this.nfpCache[JSON.stringify(key)];
                    if (nfp) {
                        for (let k = 0; k < nfp.length; k++) {
                            allNfps.push({ nfp: nfp[k], part: placedPart });
                        }
                    }
                }

                let possible = [];
                for (const binNfpItem of binNfp) {
                    let inside = true;
                    if (allNfps.length > 0) {
                        for (const nfpItem of allNfps) {
                            if (GeometryUtil.pointInPolygon(binNfpItem[0], nfpItem.nfp)) {
                                inside = false;
                                break;
                            }
                        }
                    }
                    if (inside) {
                        possible.push(binNfpItem);
                    }
                }
                
                // Final placement logic using merged NFPs
                if (possible.length > 0) {
                     // Simplified: just pick the first possible position.
                     // A full implementation would check all candidates.
                    position = { x: possible[0][0].x, y: possible[0][0].y, id, rotation };
                }
            }

            if (position) {
                placements.push(position);
                placedArea += Math.abs(GeometryUtil.polygonArea(partData));
            }
        }

        const placedBounds = this.getBounds(placements);
        fitness = placedBounds.width * placedBounds.height - placedArea;

        return {
            fitness: fitness,
            placements: [placements]
        };
    }

    getBounds(placements) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

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