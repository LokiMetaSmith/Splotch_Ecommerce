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

            // Fill background with White (to ensure black square is detected)
            // Default is transparent (0,0,0,0), which is also fine.
            // But let's be explicit to match new detectBackgroundColor logic if it assumes white for transparent corners?
            // No, detectBackgroundColor handles transparency.

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

        it('should handle off-white background with threshold', () => {
            const width = 10;
            const height = 10;
            const data = new Uint8ClampedArray(width * height * 4);

            // Fill background with "Dirty White" (240, 240, 240)
            for (let i = 0; i < data.length; i += 4) {
                data[i] = 240; data[i+1] = 240; data[i+2] = 240; data[i+3] = 255;
            }

            // Draw Black Square
            for (let y = 3; y <= 6; y++) {
                for (let x = 3; x <= 6; x++) {
                    const i = (y * width + x) * 4;
                    data[i] = 0; data[i+1] = 0; data[i+2] = 0; data[i+3] = 255;
                }
            }

            const imageData = { data, width, height };
            // Default threshold is 10. Diff is (255-240)*3 = 45 > 30? No.
            // Bg is 240. Black is 0. Diff is 240*3 = 720. 720 > 30. So Black is opaque.
            // But checking background pixels: 240 vs 240. Diff 0. So background is transparent.

            const contour = traceContour(imageData);
            expect(contour).not.toBeNull();
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
