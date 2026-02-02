import { describe, it, expect } from '@jest/globals';
import { GeometryUtil } from '../src/lib/geometryutil.js';

describe('GeometryUtil.rectsIntersect', () => {
    it('should return true for overlapping rectangles', () => {
        const r1 = { x: 0, y: 0, width: 10, height: 10 };
        const r2 = { x: 5, y: 5, width: 10, height: 10 };
        expect(GeometryUtil.rectsIntersect(r1, r2)).toBe(true);
    });

    it('should return true for contained rectangles', () => {
        const r1 = { x: 0, y: 0, width: 20, height: 20 };
        const r2 = { x: 5, y: 5, width: 5, height: 5 };
        expect(GeometryUtil.rectsIntersect(r1, r2)).toBe(true);
    });

    it('should return false for non-overlapping rectangles (right)', () => {
        const r1 = { x: 0, y: 0, width: 10, height: 10 };
        const r2 = { x: 15, y: 0, width: 10, height: 10 };
        expect(GeometryUtil.rectsIntersect(r1, r2)).toBe(false);
    });

    it('should return false for non-overlapping rectangles (bottom)', () => {
        const r1 = { x: 0, y: 0, width: 10, height: 10 };
        const r2 = { x: 0, y: 15, width: 10, height: 10 };
        expect(GeometryUtil.rectsIntersect(r1, r2)).toBe(false);
    });

    it('should return false for touching rectangles (right edge)', () => {
        const r1 = { x: 0, y: 0, width: 10, height: 10 };
        const r2 = { x: 10, y: 0, width: 10, height: 10 };
        // Assuming strict inequality for intersection
        expect(GeometryUtil.rectsIntersect(r1, r2)).toBe(false);
    });
});

describe('GeometryUtil.getRotatedPolygonBounds', () => {
    it('should calculate correct bounds for 90 degree rotation', () => {
        const poly = [{x:0, y:0}, {x:100, y:0}, {x:100, y:50}, {x:0, y:50}];
        // 100x50 rect.
        // Rotated 90 degrees around 0,0:
        // (0,0) -> (0,0)
        // (100,0) -> (0, 100)
        // (100,50) -> (-50, 100)
        // (0,50) -> (-50, 0)
        // Bounds: x: -50, y: 0, w: 50, h: 100

        const bounds = GeometryUtil.getRotatedPolygonBounds(poly, 90);

        expect(bounds.x).toBeCloseTo(-50);
        expect(bounds.y).toBeCloseTo(0);
        expect(bounds.width).toBeCloseTo(50);
        expect(bounds.height).toBeCloseTo(100);
    });

    it('should match rotatePolygon + getPolygonBounds result', () => {
        const poly = [{x:0, y:0}, {x:100, y:0}, {x:50, y:80}]; // Triangle
        const angle = 45;

        const rotated = GeometryUtil.rotatePolygon(poly, angle);
        const expected = GeometryUtil.getPolygonBounds(rotated);
        const actual = GeometryUtil.getRotatedPolygonBounds(poly, angle);

        expect(actual.x).toBeCloseTo(expected.x);
        expect(actual.y).toBeCloseTo(expected.y);
        expect(actual.width).toBeCloseTo(expected.width);
        expect(actual.height).toBeCloseTo(expected.height);
    });

    it('should handle 0 degrees optimization', () => {
        const poly = [{x:0, y:0}, {x:100, y:0}, {x:100, y:50}, {x:0, y:50}];
        const bounds = GeometryUtil.getRotatedPolygonBounds(poly, 0);
        expect(bounds).toEqual({x:0, y:0, width:100, height:50});
    });
});
