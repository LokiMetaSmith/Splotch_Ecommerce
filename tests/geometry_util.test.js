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
