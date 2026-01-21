
import { traceContour, simplifyPolygon } from '../src/lib/image-processing.js';
import assert from 'assert';

// Mock ImageData for testing without 'canvas' package
function createMockImageData(width, height) {
    return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4)
    };
}

function fillCircle(imageData, cx, cy, radius) {
    const { width, height, data } = imageData;
    const r2 = radius * radius;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = x - cx;
            const dy = y - cy;
            if (dx * dx + dy * dy <= r2) {
                const i = (y * width + x) * 4;
                data[i] = 255; // R
                data[i+1] = 0; // G
                data[i+2] = 0; // B
                data[i+3] = 255; // Alpha (opaque)
            } else {
                const i = (y * width + x) * 4;
                data[i+3] = 0; // Transparent
            }
        }
    }
}

// Calculate polygon area using Shoelace formula
function calculatePolygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        area += (p1.x * p2.y) - (p2.x * p1.y);
    }
    return Math.abs(area / 2);
}

describe('Cutline Precision', () => {

    test('Simplified polygon should be within acceptable error margin (95-100% of original area) for a circle', () => {
        // 1. Create a known shape (Circle)
        const size = 200;
        const imageData = createMockImageData(size, size);
        const radius = 80;
        fillCircle(imageData, size/2, size/2, radius);

        // 2. Trace Contour
        const contour = traceContour(imageData);

        expect(contour).not.toBeNull();
        // A circle of radius 80 has circumference ~502 pixels.
        // traceContour traces pixels, so points ~= circumference.
        expect(contour.length).toBeGreaterThan(400);

        // 3. Simplify
        const epsilon = 1.0; // Standard epsilon
        const simplified = simplifyPolygon(contour, epsilon);

        console.log(`Original points: ${contour.length}`);
        console.log(`Simplified points: ${simplified.length}`);

        expect(simplified.length).toBeLessThan(contour.length);
        // Should significantly reduce points (e.g. < 100 for a circle)
        expect(simplified.length).toBeLessThan(150);

        // 4. Verify Area Retention
        // Calculate area of original (circle area = pi * r^2)
        const expectedArea = Math.PI * radius * radius;
        const simplifiedArea = calculatePolygonArea(simplified);

        // Accuracy check
        const accuracy = simplifiedArea / expectedArea;

        console.log(`Expected Area: ${expectedArea.toFixed(2)}`);
        console.log(`Simplified Area: ${simplifiedArea.toFixed(2)}`);
        console.log(`Accuracy: ${(accuracy * 100).toFixed(2)}%`);

        // The RDP algorithm on a rasterized circle usually results in a slightly smaller polygon
        // but it should be very close. 95% is a safe lower bound for epsilon=1.0.
        expect(accuracy).toBeGreaterThan(0.95);
        expect(accuracy).toBeLessThan(1.02); // Should not be significantly larger
    });

    test('Simplified polygon should handle sharp corners (Square)', () => {
        const size = 100;
        const imageData = createMockImageData(size, size);
        // Fill square from 10,10 to 90,90
        for(let y=10; y<=90; y++) {
            for(let x=10; x<=90; x++) {
                const i = (y * size + x) * 4;
                imageData.data[i+3] = 255;
            }
        }

        const contour = traceContour(imageData);
        const simplified = simplifyPolygon(contour, 2.0); // Higher epsilon

        console.log(`Square points: ${simplified.length}`);
        // Should ideally be 4 corners + maybe start/end overlap
        // RDP on a perfect square aligned with grid should be very efficient.
        expect(simplified.length).toBeLessThan(10);

        const area = calculatePolygonArea(simplified);
        const expected = 80 * 80; // 6400
        expect(area).toBeGreaterThan(6300);
        expect(area).toBeLessThan(6500);
    });
});
