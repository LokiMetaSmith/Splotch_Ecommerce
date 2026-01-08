// /lib/geometryutil.js

/*!
 * General purpose geometry functions for polygon/Bezier calculations
 * Copyright 2015 Jack Qiao
 * Licensed under the MIT license
 */

'use strict';

// private shared variables/methods
const TOL = 1e-9; // Floating point error is likely to be above 1 epsilon

function _almostEqual(a, b, tolerance = TOL) {
    return Math.abs(a - b) < tolerance;
}

function _withinDistance(p1, p2, distance) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return ((dx * dx + dy * dy) < distance * distance);
}

function _degreesToRadians(angle) {
    return angle * (Math.PI / 180);
}

function _radiansToDegrees(angle) {
    return angle * (180 / Math.PI);
}

function _normalizeVector(v) {
    if (_almostEqual(v.x * v.x + v.y * v.y, 1)) {
        return v; // given vector was already a unit vector
    }
    const len = Math.sqrt(v.x * v.x + v.y * v.y);
    const inverse = 1 / len;
    return {
        x: v.x * inverse,
        y: v.y * inverse
    };
}

function _onSegment(A, B, p) {
    // vertical line
    if (_almostEqual(A.x, B.x) && _almostEqual(p.x, A.x)) {
        if (!_almostEqual(p.y, B.y) && !_almostEqual(p.y, A.y) && p.y < Math.max(B.y, A.y) && p.y > Math.min(B.y, A.y)) {
            return true;
        } else {
            return false;
        }
    }

    // horizontal line
    if (_almostEqual(A.y, B.y) && _almostEqual(p.y, A.y)) {
        if (!_almostEqual(p.x, B.x) && !_almostEqual(p.x, A.x) && p.x < Math.max(B.x, A.x) && p.x > Math.min(B.x, A.x)) {
            return true;
        } else {
            return false;
        }
    }

    // range check
    if ((p.x < A.x && p.x < B.x) || (p.x > A.x && p.x > B.x) || (p.y < A.y && p.y < B.y) || (p.y > A.y && p.y > B.y)) {
        return false;
    }

    // exclude end points
    if ((_almostEqual(p.x, A.x) && _almostEqual(p.y, A.y)) || (_almostEqual(p.x, B.x) && _almostEqual(p.y, B.y))) {
        return false;
    }

    const cross = (p.y - A.y) * (B.x - A.x) - (p.x - A.x) * (B.y - A.y);
    if (Math.abs(cross) > TOL) {
        return false;
    }

    const dot = (p.x - A.x) * (B.x - A.x) + (p.y - A.y) * (B.y - A.y);
    if (dot < 0 || _almostEqual(dot, 0)) {
        return false;
    }

    const len2 = (B.x - A.x) * (B.x - A.x) + (B.y - A.y) * (B.y - A.y);
    if (dot > len2 || _almostEqual(dot, len2)) {
        return false;
    }

    return true;
}

function _lineIntersect(A, B, E, F, infinite) {
    const a1 = B.y - A.y;
    const b1 = A.x - B.x;
    const c1 = B.x * A.y - A.x * B.y;
    const a2 = F.y - E.y;
    const b2 = E.x - F.x;
    const c2 = F.x * E.y - E.x * F.y;

    const denom = a1 * b2 - a2 * b1;
    const x = (b1 * c2 - b2 * c1) / denom;
    const y = (a2 * c1 - a1 * c2) / denom;

    if (!isFinite(x) || !isFinite(y)) {
        return null;
    }

    if (!infinite) {
        if (Math.abs(A.x - B.x) > TOL && ((A.x < B.x) ? x < A.x || x > B.x : x > A.x || x < B.x)) return null;
        if (Math.abs(A.y - B.y) > TOL && ((A.y < B.y) ? y < A.y || y > B.y : y > A.y || y < B.y)) return null;
        if (Math.abs(E.x - F.x) > TOL && ((E.x < F.x) ? x < E.x || x > F.x : x > E.x || x < F.x)) return null;
        if (Math.abs(E.y - F.y) > TOL && ((E.y < F.y) ? y < E.y || y > F.y : y > E.y || y < F.y)) return null;
    }

    return { x, y };
}

export const GeometryUtil = {
    withinDistance: _withinDistance,
    lineIntersect: _lineIntersect,
    almostEqual: _almostEqual,

    QuadraticBezier: {
        isFlat: function(p1, p2, c1, tol) {
            tol = 4 * tol * tol;
            let ux = 2 * c1.x - p1.x - p2.x;
            ux *= ux;
            let uy = 2 * c1.y - p1.y - p2.y;
            uy *= uy;
            return (ux + uy <= tol);
        },
        linearize: function(p1, p2, c1, tol) {
            const finished = [p1];
            const todo = [{ p1, p2, c1 }];
            while (todo.length > 0) {
                const segment = todo[0];
                if (this.isFlat(segment.p1, segment.p2, segment.c1, tol)) {
                    finished.push({ x: segment.p2.x, y: segment.p2.y });
                    todo.shift();
                } else {
                    const divided = this.subdivide(segment.p1, segment.p2, segment.c1, 0.5);
                    todo.splice(0, 1, divided[0], divided[1]);
                }
            }
            return finished;
        },
        subdivide: function(p1, p2, c1, t) {
            const mid1 = { x: p1.x + (c1.x - p1.x) * t, y: p1.y + (c1.y - p1.y) * t };
            const mid2 = { x: c1.x + (p2.x - c1.x) * t, y: c1.y + (p2.y - c1.y) * t };
            const mid3 = { x: mid1.x + (mid2.x - mid1.x) * t, y: mid1.y + (mid2.y - mid1.y) * t };
            const seg1 = { p1, p2: mid3, c1: mid1 };
            const seg2 = { p1: mid3, p2, c1: mid2 };
            return [seg1, seg2];
        }
    },

    CubicBezier: {
        isFlat: function(p1, p2, c1, c2, tol) {
            tol = 16 * tol * tol;
            let ux = 3 * c1.x - 2 * p1.x - p2.x;
            ux *= ux;
            let uy = 3 * c1.y - 2 * p1.y - p2.y;
            uy *= uy;
            let vx = 3 * c2.x - 2 * p2.x - p1.x;
            vx *= vx;
            let vy = 3 * c2.y - 2 * p2.y - p1.y;
            vy *= vy;
            if (ux < vx) ux = vx;
            if (uy < vy) uy = vy;
            return (ux + uy <= tol);
        },
        linearize: function(p1, p2, c1, c2, tol) {
            const finished = [p1];
            const todo = [{ p1, p2, c1, c2 }];
            while (todo.length > 0) {
                const segment = todo[0];
                if (this.isFlat(segment.p1, segment.p2, segment.c1, segment.c2, tol)) {
                    finished.push({ x: segment.p2.x, y: segment.p2.y });
                    todo.shift();
                } else {
                    const divided = this.subdivide(segment.p1, segment.p2, segment.c1, segment.c2, 0.5);
                    todo.splice(0, 1, divided[0], divided[1]);
                }
            }
            return finished;
        },
        subdivide: function(p1, p2, c1, c2, t) {
            const mid1 = { x: p1.x + (c1.x - p1.x) * t, y: p1.y + (c1.y - p1.y) * t };
            const mid2 = { x: c2.x + (p2.x - c2.x) * t, y: c2.y + (p2.y - c2.y) * t };
            const mid3 = { x: c1.x + (c2.x - c1.x) * t, y: c1.y + (c2.y - c1.y) * t };
            const mida = { x: mid1.x + (mid3.x - mid1.x) * t, y: mid1.y + (mid3.y - mid1.y) * t };
            const midb = { x: mid3.x + (mid2.x - mid3.x) * t, y: mid3.y + (mid2.y - mid3.y) * t };
            const midx = { x: mida.x + (midb.x - mida.x) * t, y: mida.y + (midb.y - mida.y) * t };
            const seg1 = { p1, p2: midx, c1: mid1, c2: mida };
            const seg2 = { p1: midx, p2, c1: midb, c2: mid2 };
            return [seg1, seg2];
        }
    },

    Arc: {
        linearize: function(p1, p2, rx, ry, angle, largearc, sweep, tol) {
            const finished = [p2];
            let arc = this.svgToCenter(p1, p2, rx, ry, angle, largearc, sweep);
            const todo = [arc];
            while (todo.length > 0) {
                arc = todo[0];
                const fullarc = this.centerToSvg(arc.center, arc.rx, arc.ry, arc.theta, arc.extent, arc.angle);
                const subarc = this.centerToSvg(arc.center, arc.rx, arc.ry, arc.theta, 0.5 * arc.extent, arc.angle);
                const arcmid = subarc.p2;
                const mid = { x: 0.5 * (fullarc.p1.x + fullarc.p2.x), y: 0.5 * (fullarc.p1.y + fullarc.p2.y) };
                if (_withinDistance(mid, arcmid, tol)) {
                    finished.unshift(fullarc.p2);
                    todo.shift();
                } else {
                    const arc1 = { ...arc, extent: 0.5 * arc.extent };
                    const arc2 = { ...arc, theta: arc.theta + 0.5 * arc.extent, extent: 0.5 * arc.extent };
                    todo.splice(0, 1, arc1, arc2);
                }
            }
            return finished;
        },
        centerToSvg: function(center, rx, ry, theta1, extent, angleDegrees) {
            const theta2 = theta1 + extent;
            const t1Rad = _degreesToRadians(theta1);
            const t2Rad = _degreesToRadians(theta2);
            const angleRad = _degreesToRadians(angleDegrees);
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);
            const t1cos = Math.cos(t1Rad);
            const t1sin = Math.sin(t1Rad);
            const t2cos = Math.cos(t2Rad);
            const t2sin = Math.sin(t2Rad);
            const x0 = center.x + cos * rx * t1cos + (-sin) * ry * t1sin;
            const y0 = center.y + sin * rx * t1cos + cos * ry * t1sin;
            const x1 = center.x + cos * rx * t2cos + (-sin) * ry * t2sin;
            const y1 = center.y + sin * rx * t2cos + cos * ry * t2sin;
            return {
                p1: { x: x0, y: y0 }, p2: { x: x1, y: y1 },
                rx, ry, angle: angleDegrees,
                largearc: (extent > 180) ? 1 : 0,
                sweep: (extent > 0) ? 1 : 0,
            };
        },
        svgToCenter: function(p1, p2, rx, ry, angleDegrees, largearc, sweep) {
            const diff = { x: 0.5 * (p1.x - p2.x), y: 0.5 * (p1.y - p2.y) };
            const angleRad = _degreesToRadians(angleDegrees % 360);
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);
            const x1 = cos * diff.x + sin * diff.y;
            const y1 = -sin * diff.x + cos * diff.y;
            rx = Math.abs(rx);
            ry = Math.abs(ry);
            let Prx = rx * rx;
            let Pry = ry * ry;
            let Px1 = x1 * x1;
            let Py1 = y1 * y1;
            const radiiCheck = Px1 / Prx + Py1 / Pry;
            if (radiiCheck > 1) {
                const radiiSqrt = Math.sqrt(radiiCheck);
                rx = radiiSqrt * rx;
                ry = radiiSqrt * ry;
                Prx = rx * rx;
                Pry = ry * ry;
            }
            const sign = (largearc === sweep) ? -1 : 1;
            let sq = ((Prx * Pry) - (Prx * Py1) - (Pry * Px1)) / ((Prx * Py1) + (Pry * Px1));
            sq = (sq < 0) ? 0 : sq;
            const coef = sign * Math.sqrt(sq);
            const cx1 = coef * ((rx * y1) / ry);
            const cy1 = coef * -((ry * x1) / rx);
            const center = {
                x: (p1.x + p2.x) / 2 + (cos * cx1 - sin * cy1),
                y: (p1.y + p2.y) / 2 + (sin * cx1 + cos * cy1),
            };
            const ux = (x1 - cx1) / rx;
            const uy = (y1 - cy1) / ry;
            const vx = (-x1 - cx1) / rx;
            const vy = (-y1 - cy1) / ry;
            const n1 = Math.sqrt(ux * ux + uy * uy);
            let p1Rad = Math.acos(ux / n1);
            if (uy < 0) p1Rad *= -1;
            const n2 = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
            let p2Rad = Math.acos((ux * vx + uy * vy) / n2);
            if ((ux * vy - uy * vx) < 0) p2Rad *= -1;
            let theta = _radiansToDegrees(p1Rad);
            let delta = _radiansToDegrees(p2Rad % (2 * Math.PI));
            if (!sweep && delta > 0) delta -= 360;
            if (sweep && delta < 0) delta += 360;
            return { center, rx, ry, theta, extent: delta, angle: angleDegrees };
        }
    },

    getPolygonBounds: function(polygon) {
        if (!polygon || polygon.length < 1) return null;
        let xmin = polygon[0].x, xmax = polygon[0].x;
        let ymin = polygon[0].y, ymax = polygon[0].y;
        for (let i = 1; i < polygon.length; i++) {
            if (polygon[i].x > xmax) xmax = polygon[i].x;
            else if (polygon[i].x < xmin) xmin = polygon[i].x;
            if (polygon[i].y > ymax) ymax = polygon[i].y;
            else if (polygon[i].y < ymin) ymin = polygon[i].y;
        }
        return { x: xmin, y: ymin, width: xmax - xmin, height: ymax - ymin };
    },

    pointInPolygon: function(point, polygon) {
        if (!polygon || polygon.length < 3) return null;

        // Optimization: Check bounding box first
        // If polygon doesn't have cached bounds, calculate them once (this is O(N))
        // but saves us from the O(N) ray casting if the point is clearly outside.
        // We cache LOCAL bounds (ignoring offset) so they remain valid even if the polygon is moved.
        if (!polygon._bounds) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < polygon.length; i++) {
                 const x = polygon[i].x;
                 const y = polygon[i].y;
                 if (x < minX) minX = x;
                 if (x > maxX) maxX = x;
                 if (y < minY) minY = y;
                 if (y > maxY) maxY = y;
            }
            // Cache it (non-enumerable to avoid polluting JSON stringify if needed)
            // Note: We use Object.defineProperty to ensure the property is not enumerable,
            // preventing it from being serialized to JSON.
            try {
                Object.defineProperty(polygon, '_bounds', {
                    value: { minX, minY, maxX, maxY },
                    writable: true,
                    configurable: true,
                    enumerable: false
                });
            } catch (e) {
                 // Fallback if object is frozen/sealed: just use a temporary variable (no caching benefit for this single call, but safe)
                 polygon._bounds = { minX, minY, maxX, maxY };
            }
        }

        const b = polygon._bounds;
        const offsetx = polygon.offsetx || 0;
        const offsety = polygon.offsety || 0;

        if (point.x < b.minX + offsetx || point.x > b.maxX + offsetx || point.y < b.minY + offsety || point.y > b.maxY + offsety) {
            return false;
        }

        let inside = false;
        // The variables offsetx and offsety are already declared above
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x + offsetx, yi = polygon[i].y + offsety;
            const xj = polygon[j].x + offsetx, yj = polygon[j].y + offsety;
            if (_almostEqual(xi, point.x) && _almostEqual(yi, point.y)) return null;
            if (_onSegment({ x: xi, y: yi }, { x: xj, y: yj }, point)) return null;
            if (_almostEqual(xi, xj) && _almostEqual(yi, yj)) continue;
            const intersect = ((yi > point.y) !== (yj > point.y)) && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    },

    polygonArea: function(polygon) {
        let area = 0;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
        }
        return 0.5 * area;
    },

    rotatePolygon: function(polygon, angle) {
        if (!polygon || polygon.length === 0) return [];
        const angleRad = _degreesToRadians(angle);
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const rotated = [];
        for (let i = 0; i < polygon.length; i++) {
            rotated.push({
                x: polygon[i].x * cos - polygon[i].y * sin,
                y: polygon[i].x * sin + polygon[i].y * cos
            });
        }
        if (polygon.id !== undefined) rotated.id = polygon.id;
        if (polygon.source) rotated.source = polygon.source;
        return rotated;
    },
    
    // ... other methods from original file can be added here ...
};