
import { traceContour } from '../src/lib/image-processing.js';

describe('traceContour', () => {
    // Helper to create a blank ImageData
    function createImageData(width, height) {
        return {
            width,
            height,
            data: new Uint8ClampedArray(width * height * 4) // All zeros (transparent)
        };
    }

    // Helper to set a pixel color
    function setPixel(imageData, x, y, r, g, b, a) {
        const i = (y * imageData.width + x) * 4;
        imageData.data[i] = r;
        imageData.data[i+1] = g;
        imageData.data[i+2] = b;
        imageData.data[i+3] = a;
    }

    // Helper to draw a rect
    function fillRect(imageData, x, y, w, h, r, g, b, a) {
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                setPixel(imageData, x + dx, y + dy, r, g, b, a);
            }
        }
    }

    test('ignores small noise and returns the largest contour (main shape)', () => {
        const width = 100;
        const height = 100;
        const img = createImageData(width, height);

        // 1. Add "Noise" at (5, 5) - a single pixel
        setPixel(img, 5, 5, 0, 0, 0, 255); // Black opaque

        // 2. Add "Main Shape" at (50, 50) - 10x10 square
        fillRect(img, 50, 50, 10, 10, 0, 0, 0, 255);

        // Run traceContour
        const contour = traceContour(img);

        // Assertions
        expect(contour).not.toBeNull();

        // Check bounds of the found contour
        let minX = width, maxX = 0, minY = height, maxY = 0;
        contour.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });

        // Current behavior (fix): It should find the main shape at (50,50)
        // Bounds should be around 50-60
        expect(minX).toBeGreaterThanOrEqual(49);
        expect(maxX).toBeLessThanOrEqual(61);
        expect(minY).toBeGreaterThanOrEqual(49);
        expect(maxY).toBeLessThanOrEqual(61);

        console.log(`Found contour bounds: (${minX},${minY}) to (${maxX},${maxY})`);
    });
});
