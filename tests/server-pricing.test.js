
import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';
import { getDesignDimensions, calculatePerimeter } from '../server/pricing.js';

const tempSvgPath = path.join(process.cwd(), 'tests', 'temp_test.svg');
const complexSvgPath = path.join(process.cwd(), 'tests', 'complex_test.svg');

describe('getDesignDimensions', () => {
    beforeAll(() => {
        // Create a simple SVG file
        const svgContent = `
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" />
</svg>`;
        fs.writeFileSync(tempSvgPath, svgContent);

        // Create a complex SVG file with curves
        const complexSvgContent = `
<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <path d="M 10 90 C 30 90, 30 10, 50 10 S 70 90, 90 90" />
  <path d="M 110 90 Q 130 10, 150 90 T 190 90" />
</svg>`;
        fs.writeFileSync(complexSvgPath, complexSvgContent);
    });

    afterAll(() => {
        if (fs.existsSync(tempSvgPath)) {
            fs.unlinkSync(tempSvgPath);
        }
        if (fs.existsSync(complexSvgPath)) {
            fs.unlinkSync(complexSvgPath);
        }
    });

    it('should correctly calculate dimensions and cutline for simple SVG', async () => {
        const readFileSyncSpy = jest.spyOn(fs, 'readFileSync');
        const readFileAsyncSpy = jest.spyOn(fs.promises, 'readFile');

        try {
            const result = await getDesignDimensions(tempSvgPath);

            expect(result.bounds).toEqual({ width: 100, height: 100 });
            expect(result.cutline).toBeDefined();
            // Perimeter of 80x80 square = 320
            // The path is M 10 10 L 90 10 L 90 90 L 10 90 Z
            // 80 + 80 + 80 + 80 = 320
            const perimeter = calculatePerimeter(result.cutline);
            expect(perimeter).toBeCloseTo(320, 1);

            expect(readFileSyncSpy).not.toHaveBeenCalled();
            expect(readFileAsyncSpy).toHaveBeenCalledWith(tempSvgPath, 'utf8');

        } finally {
            readFileSyncSpy.mockRestore();
            readFileAsyncSpy.mockRestore();
        }
    });

    it('should correctly calculate perimeter for complex path commands (C, S, Q, T)', async () => {
        const result = await getDesignDimensions(complexSvgPath);
        // We expect a valid calculation, not 0 and not linear approximation
        const perimeter = calculatePerimeter(result.cutline);
        expect(perimeter).toBeGreaterThan(100);
        // Value from previous test run was ~373.58
        expect(perimeter).toBeCloseTo(373.58, 1);
    });
});
