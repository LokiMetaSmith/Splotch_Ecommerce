import { filterInternalContours, getPolygonMetrics } from '../src/lib/image-processing.js';

describe('filterInternalContours and getPolygonMetrics', () => {

    test('getPolygonMetrics calculates correct bounds and area', () => {
        const points = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ];

        const metrics = getPolygonMetrics(points);
        expect(metrics.area).toBe(100);
        expect(metrics.bounds).toEqual({
            minX: 0, maxX: 10, minY: 0, maxY: 10, width: 10, height: 10
        });
    });

    test('filterInternalContours correctly identifies and processes holes', () => {
        // Outer square (CW winding)
        const outer = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 }
        ];

        // Inner hole (CW winding initially)
        const hole = [
            { x: 20, y: 20 },
            { x: 80, y: 20 },
            { x: 80, y: 80 },
            { x: 20, y: 80 }
        ];

        // Small noise hole (CW winding) - MUST BE HOLE (depth 1), so inside outer but outside inner hole
        const noise = [
            { x: 10, y: 10 },
            { x: 11, y: 10 },
            { x: 11, y: 11 },
            { x: 10, y: 11 }
        ];

        const contours = [hole, outer, noise];

        // maxAllowedHoleSize: 80 (larger than hole 60x60)
        // minAllowedHoleSize: 5 (larger than noise 1x1)
        const result = filterInternalContours(contours, 80, 5);

        // Expect: Outer (CW) and Hole (CCW/Reversed). Noise removed.
        expect(result.length).toBe(2);

        // Find the large one
        const resultOuter = result.find(c => getPolygonMetrics(c).area > 5000);
        expect(resultOuter).toBeDefined();
        // Should match original outer (no reverse)
        expect(resultOuter[0]).toEqual(outer[0]);

        // Find the hole
        const resultHole = result.find(c => {
             const area = getPolygonMetrics(c).area;
             return area > 100 && area < 5000;
        });
        expect(resultHole).toBeDefined();

        // Should be reversed
        expect(resultHole[0]).toEqual(hole[3]);
    });
});
