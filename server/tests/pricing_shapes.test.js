
import { getDesignDimensions } from '../pricing.js';
import fs from 'fs';
import path from 'path';

const testSvgPath = path.join(process.cwd(), 'test_rect.svg');

describe('Server Pricing - Basic Shapes', () => {
    const rectSvgPath = path.join(process.cwd(), 'test_rect.svg');
    const circleSvgPath = path.join(process.cwd(), 'test_circle.svg');
    const polygonSvgPath = path.join(process.cwd(), 'test_polygon.svg');

    beforeAll(() => {
        // Rect: 80x80 -> P=320
        fs.writeFileSync(rectSvgPath, `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="10" width="80" height="80" />
        </svg>`);

        // Circle: r=50 -> P = 2*PI*50 = 314.159...
        fs.writeFileSync(circleSvgPath, `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="50" />
        </svg>`);

        // Polygon: Triangle (0,0) (30,0) (0,40)
        // Sides: 30, 40, 50 (3-4-5 triangle). P = 120
        fs.writeFileSync(polygonSvgPath, `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
            <polygon points="0,0 30,0 0,40" />
        </svg>`);
    });

    afterAll(() => {
        if (fs.existsSync(rectSvgPath)) fs.unlinkSync(rectSvgPath);
        if (fs.existsSync(circleSvgPath)) fs.unlinkSync(circleSvgPath);
        if (fs.existsSync(polygonSvgPath)) fs.unlinkSync(polygonSvgPath);
    });

    // Helper to calculate perimeter from cutline
    function getCutlinePerimeter(cutline) {
        const poly = cutline[0];
        let calculatedPerimeter = 0;
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length];
            calculatedPerimeter += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
        }
        return calculatedPerimeter;
    }

    it('should calculate perimeter for rect elements', async () => {
        const dimensions = await getDesignDimensions(rectSvgPath);
        const p = getCutlinePerimeter(dimensions.cutline);
        expect(p).toBeCloseTo(320, 1);
    });

    it('should calculate perimeter for circle elements', async () => {
        const dimensions = await getDesignDimensions(circleSvgPath);
        const p = getCutlinePerimeter(dimensions.cutline);
        expect(p).toBeCloseTo(2 * Math.PI * 50, 1);
    });

    it('should calculate perimeter for polygon elements', async () => {
        const dimensions = await getDesignDimensions(polygonSvgPath);
        const p = getCutlinePerimeter(dimensions.cutline);
        expect(p).toBeCloseTo(120, 1);
    });
});
