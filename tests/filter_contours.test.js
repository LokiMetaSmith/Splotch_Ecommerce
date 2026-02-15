
import { filterInternalContours } from '../src/lib/image-processing.js';

describe('filterInternalContours', () => {

    const createRect = (x, y, w, h) => [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h }
    ];

    it('should keep the main outer contour', () => {
        const outer = createRect(0, 0, 100, 100);
        const contours = [outer];
        // maxAllowedHoleSize = 10, minAllowedHoleSize = 0 (default)
        const result = filterInternalContours(contours, 10);
        expect(result).toHaveLength(1);
        // Outer is solid -> kept as is
        expect(result[0]).toBe(outer);
    });

    it('should remove internal holes larger than maxAllowedHoleSize', () => {
        const outer = createRect(0, 0, 100, 100);
        const bigHole = createRect(10, 10, 50, 50); // 50 > 10
        const contours = [outer, bigHole];

        const result = filterInternalContours(contours, 10);

        expect(result).toHaveLength(1);
        expect(result[0]).toBe(outer); // bigHole removed
    });

    it('should remove internal holes SMALLER than minAllowedHoleSize (noise)', () => {
        const outer = createRect(0, 0, 100, 100);
        const noiseHole = createRect(10, 10, 2, 2); // 2 < 5
        const validHole = createRect(20, 20, 8, 8); // 5 <= 8 <= 10
        const contours = [outer, noiseHole, validHole];

        // max=10, min=5
        const result = filterInternalContours(contours, 10, 5);

        expect(result).toHaveLength(2);
        expect(result).toContain(outer);

        // noiseHole removed
        const reversedValidHole = [...validHole].reverse();
        const foundHole = result.find(c => c !== outer);
        expect(foundHole).toEqual(reversedValidHole);
    });

    it('should keep internal holes within range AND REVERSE THEM', () => {
        const outer = createRect(0, 0, 100, 100);
        const smallHole = createRect(10, 10, 5, 5); // 5 <= 10
        const contours = [outer, smallHole];

        const result = filterInternalContours(contours, 10);

        expect(result).toHaveLength(2);
        // Outer (Solid) kept as is
        expect(result).toContain(outer);

        // Small Hole (Hole) should be reversed
        const reversedHole = [...smallHole].reverse();
        const foundHole = result.find(c => c !== outer);
        expect(foundHole).toEqual(reversedHole);
    });

    it('should handle multiple holes mixed', () => {
        const outer = createRect(0, 0, 100, 100);
        const bigHole = createRect(10, 10, 50, 50); // Remove (>10)
        const smallHole = createRect(70, 70, 5, 5); // Keep (Reverse)
        const noiseHole = createRect(80, 80, 1, 1); // Remove (<2)
        const contours = [outer, bigHole, smallHole, noiseHole];

        const result = filterInternalContours(contours, 10, 2); // min=2

        expect(result).toHaveLength(2); // outer + smallHole. bigHole removed (>10), noiseHole removed (<2)
        expect(result).toContain(outer);

        const reversedHole = [...smallHole].reverse();
        const foundHole = result.find(c => c !== outer);
        expect(foundHole).toEqual(reversedHole);
    });
});
