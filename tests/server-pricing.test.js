
import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';
import { getDesignDimensions } from '../server/pricing.js';

const tempSvgPath = path.join(process.cwd(), 'tests', 'temp_test.svg');

describe('getDesignDimensions', () => {
    beforeAll(() => {
        // Create a simple SVG file
        const svgContent = `
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" />
</svg>`;
        fs.writeFileSync(tempSvgPath, svgContent);
    });

    afterAll(() => {
        if (fs.existsSync(tempSvgPath)) {
            fs.unlinkSync(tempSvgPath);
        }
    });

    it('should correctly calculate dimensions and cutline for SVG', async () => {
        const readFileSyncSpy = jest.spyOn(fs, 'readFileSync');
        const readFileAsyncSpy = jest.spyOn(fs.promises, 'readFile');

        try {
            const result = await getDesignDimensions(tempSvgPath);

            expect(result.bounds).toEqual({ width: 100, height: 100 });
            expect(result.cutline).toBeDefined();

            expect(readFileSyncSpy).not.toHaveBeenCalled();
            expect(readFileAsyncSpy).toHaveBeenCalledWith(tempSvgPath, 'utf8');

        } finally {
            readFileSyncSpy.mockRestore();
            readFileAsyncSpy.mockRestore();
        }
    });
});
