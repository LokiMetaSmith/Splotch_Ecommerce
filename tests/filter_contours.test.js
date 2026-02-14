
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
        // minDimension = 10
        const result = filterInternalContours(contours, 10);
        expect(result).toHaveLength(1);
        // Outer is solid -> kept as is
        expect(result[0]).toBe(outer);
    });

    it('should remove internal holes larger than minDimension', () => {
        const outer = createRect(0, 0, 100, 100);
        const bigHole = createRect(10, 10, 50, 50); // 50 > 10
        const contours = [outer, bigHole];

        const result = filterInternalContours(contours, 10);

        expect(result).toHaveLength(1);
        expect(result[0]).toBe(outer); // bigHole removed
    });

    it('should keep internal holes smaller than or equal to minDimension AND REVERSE THEM', () => {
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
        const bigHole = createRect(10, 10, 50, 50); // Remove
        const smallHole = createRect(70, 70, 5, 5); // Keep (Reverse)
        const contours = [outer, bigHole, smallHole];

        const result = filterInternalContours(contours, 10);

        expect(result).toHaveLength(2);
        expect(result).toContain(outer);

        const reversedHole = [...smallHole].reverse();
        const foundHole = result.find(c => c !== outer);
        expect(foundHole).toEqual(reversedHole);
    });
});
