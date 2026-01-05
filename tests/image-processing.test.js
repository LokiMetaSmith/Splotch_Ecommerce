// tests/image-processing.test.js
import { imageHasTransparentBorder, traceContour, simplifyPolygon, perpendicularDistance } from '../src/lib/image-processing.js';

describe('Image Processing Library', () => {

    describe('imageHasTransparentBorder', () => {
        it('should detect a transparent border', () => {
            const width = 100;
            const height = 100;
            const data = new Uint8ClampedArray(width * height * 4);

            // Fill with opaque red, but leave a 10px border transparent (0,0,0,0 default)
            for (let y = 10; y < height - 10; y++) {
                for (let x = 10; x < width - 10; x++) {
                    const i = (y * width + x) * 4;
                    data[i] = 255;   // R
                    data[i+1] = 0;   // G
                    data[i+2] = 0;   // B
                    data[i+3] = 255; // A
                }
            }

            const imageData = { data, width, height };
            expect(imageHasTransparentBorder(imageData)).toBe(true);
        });

        it('should detect a white border as "transparent" for cutline purposes', () => {
            const width = 100;
            const height = 100;
            const data = new Uint8ClampedArray(width * height * 4);

            // Fill entire image with white
            for (let i = 0; i < data.length; i += 4) {
                data[i] = 255;
                data[i+1] = 255;
                data[i+2] = 255;
                data[i+3] = 255;
            }

            // Make center black
            for (let y = 10; y < height - 10; y++) {
                for (let x = 10; x < width - 10; x++) {
                    const i = (y * width + x) * 4;
                    data[i] = 0;
                    data[i+1] = 0;
                    data[i+2] = 0;
                    data[i+3] = 255;
                }
            }

            const imageData = { data, width, height };
            expect(imageHasTransparentBorder(imageData)).toBe(true);
        });

        it('should return false for a full bleed image', () => {
            const width = 100;
            const height = 100;
            const data = new Uint8ClampedArray(width * height * 4);

            // Fill entire image with opaque red
            for (let i = 0; i < data.length; i += 4) {
                data[i] = 255;
                data[i+1] = 0;
                data[i+2] = 0;
                data[i+3] = 255;
            }

            const imageData = { data, width, height };
            expect(imageHasTransparentBorder(imageData)).toBe(false);
        });
    });

    describe('traceContour', () => {
        it('should trace a simple square', () => {
            // 10x10 image, 4x4 square in middle (offsets 3,3 to 6,6)
            const width = 10;
            const height = 10;
            const data = new Uint8ClampedArray(width * height * 4);

            for (let y = 3; y <= 6; y++) {
                for (let x = 3; x <= 6; x++) {
                    const i = (y * width + x) * 4;
                    data[i] = 0; data[i+1] = 0; data[i+2] = 0; data[i+3] = 255; // Black opaque
                }
            }

            const imageData = { data, width, height };
            const contour = traceContour(imageData);

            expect(contour).not.toBeNull();
            expect(contour.length).toBeGreaterThan(0);

            // Check that all points in contour are on the boundary
            contour.forEach(pt => {
                expect(pt.x).toBeGreaterThanOrEqual(3);
                expect(pt.x).toBeLessThanOrEqual(6);
                expect(pt.y).toBeGreaterThanOrEqual(3);
                expect(pt.y).toBeLessThanOrEqual(6);
            });
        });

        it('should return null for empty image', () => {
            const width = 10;
            const height = 10;
            const data = new Uint8ClampedArray(width * height * 4); // All transparent
            const imageData = { data, width, height };

            const contour = traceContour(imageData);
            expect(contour).toBeNull();
        });

        it('should trace a full-bleed opaque image correctly', () => {
            const width = 10;
            const height = 10;
            const data = new Uint8ClampedArray(width * height * 4);
            // Fill completely opaque
            for (let i = 0; i < data.length; i += 4) {
                data[i+3] = 255;
            }

            const imageData = { data, width, height };
            const contour = traceContour(imageData);

            expect(contour).not.toBeNull();
            // It should trace the outer boundary: (0,0) -> (0,9) -> (9,9) -> (9,0) -> (0,0)
            // The algorithm might visit every pixel on the edge.
            // Perimeter is 10+10+10+10 - 4 = 36 pixels.
            expect(contour.length).toBeGreaterThan(10);

            // Verify bounds
            let minX = 10, maxX = 0, minY = 10, maxY = 0;
            contour.forEach(p => {
                if(p.x < minX) minX = p.x;
                if(p.x > maxX) maxX = p.x;
                if(p.y < minY) minY = p.y;
                if(p.y > maxY) maxY = p.y;
            });

            expect(minX).toBe(0);
            expect(maxX).toBe(9);
            expect(minY).toBe(0);
            expect(maxY).toBe(9);
        });
    });

    describe('simplifyPolygon', () => {
        it('should simplify a straight line with extra points', () => {
            const points = [
                {x: 0, y: 0},
                {x: 1, y: 1}, // On the line
                {x: 2, y: 2}, // On the line
                {x: 5, y: 5}
            ];
            // Epsilon 0.1 should remove intermediate points
            const simplified = simplifyPolygon(points, 0.1);
            expect(simplified.length).toBe(2);
            expect(simplified[0]).toEqual({x: 0, y: 0});
            expect(simplified[1]).toEqual({x: 5, y: 5});
        });

        it('should keep points that deviate more than epsilon', () => {
            const points = [
                {x: 0, y: 0},
                {x: 5, y: 5}, // Point far away
                {x: 10, y: 0}
            ];
            // Line from (0,0) to (10,0) is y=0. Point (5,5) dist is 5.
            const simplified = simplifyPolygon(points, 1.0);
            expect(simplified.length).toBe(3);
        });

        it('should return points as-is if less than 3', () => {
             const points = [
                {x: 0, y: 0},
                {x: 10, y: 0}
            ];
            const simplified = simplifyPolygon(points, 1.0);
            expect(simplified.length).toBe(2);
        });
    });

    describe('perpendicularDistance', () => {
        it('should calculate distance correctly', () => {
            const p = {x: 5, y: 5};
            const l1 = {x: 0, y: 0};
            const l2 = {x: 10, y: 0};
            // Distance from (5,5) to x-axis is 5
            expect(perpendicularDistance(p, l1, l2)).toBe(5);
        });
    });

});
