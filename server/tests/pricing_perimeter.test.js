import { jest } from '@jest/globals';
import { calculatePerimeter } from '../pricing.js';

describe('Pricing - calculatePerimeter', () => {
    test('should calculate perimeter for a square cut', () => {
        // A 10x10 square
        const polygons = [[
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ]];

        // 10 + 10 + 10 + 10 = 40
        expect(calculatePerimeter(polygons)).toBe(40);
    });

    test('should calculate perimeter for a simple triangle (custom cut)', () => {
        // A 3-4-5 right triangle
        const polygons = [[
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 0, y: 4 }
        ]];

        // 3 + 5 + 4 = 12
        expect(calculatePerimeter(polygons)).toBe(12);
    });

    test('should handle multiple polygons (islands/holes)', () => {
        // Two disjoint 10x10 squares
        const polygons = [
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ],
            [
                { x: 20, y: 20 },
                { x: 30, y: 20 },
                { x: 30, y: 30 },
                { x: 20, y: 30 }
            ]
        ];

        // 40 + 40 = 80
        expect(calculatePerimeter(polygons)).toBe(80);
    });

    test('should handle a circle approximation (round cut)', () => {
        // A simple octagon approximating a circle of radius ~5
        const r = 5;
        const numPoints = 8;
        const poly = [];
        for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2;
            poly.push({
                x: Math.cos(angle) * r,
                y: Math.sin(angle) * r
            });
        }

        const polygons = [poly];
        const perimeter = calculatePerimeter(polygons);

        // Side length of octagon = 2 * r * sin(pi/8)
        // Perimeter = 8 * 2 * 5 * sin(pi/8) ~ 30.614
        const expectedPerimeter = 8 * 2 * r * Math.sin(Math.PI / 8);
        expect(perimeter).toBeCloseTo(expectedPerimeter, 3);
    });

    test('should handle a shape with no white border (tight cut)', () => {
        // Let's say we have a star shape tightly cropped.
        // It's just a complex polygon.
        const polygons = [[
            { x: 5, y: 0 },
            { x: 6, y: 4 },
            { x: 10, y: 4 },
            { x: 7, y: 6 },
            { x: 8, y: 10 },
            { x: 5, y: 7 },
            { x: 2, y: 10 },
            { x: 3, y: 6 },
            { x: 0, y: 4 },
            { x: 4, y: 4 }
        ]];

        // We just ensure it calculates a number without failing or throwing NaN
        const perimeter = calculatePerimeter(polygons);
        expect(perimeter).toBeGreaterThan(0);
        expect(Number.isFinite(perimeter)).toBe(true);
    });

    test('should handle degenerate/invalid polygons gracefully', () => {
        expect(calculatePerimeter(null)).toBe(0);
        expect(calculatePerimeter([])).toBe(0);
        expect(calculatePerimeter([[]])).toBe(0);
        // Polygon with only 1 point
        expect(calculatePerimeter([[{ x: 0, y: 0 }]])).toBe(0);

        // Missing coordinates or bad types
        const malformedPolygons = [[
            { x: 0, y: 0 },
            { x: 10 }, // missing y
            { y: 10 }, // missing x
            null,
            { x: 0, y: 10 }
        ]];

        // It should just skip invalid points and continue or handle it gracefully
        // Currently it skips the segment if either prev or curr is invalid
        const perimeter = calculatePerimeter(malformedPolygons);
        expect(Number.isNaN(perimeter)).toBe(false);
    });
});
