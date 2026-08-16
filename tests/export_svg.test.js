import { generateMultiLayerSvg } from "../src/lib/pricing.js";

describe("generateMultiLayerSvg", () => {
    it("should return null if bounds are not provided", () => {
        expect(generateMultiLayerSvg([], [])).toBeNull();
    });

    it("should generate a valid multi-layer SVG string", () => {
        const bounds = { width: 100, height: 100, left: 10, top: 10 };
        const designLayers = [
            {
                visible: true,
                x: 5,
                y: 5,
                currentCutline: [
                    [{x: 10, y: 10}, {x: 20, y: 10}, {x: 20, y: 20}, {x: 10, y: 20}]
                ]
            }
        ];
        const sheetBoundary = [
            [{x: 0, y: 0}, {x: 30, y: 0}, {x: 30, y: 30}, {x: 0, y: 30}]
        ];

        const svg = generateMultiLayerSvg(designLayers, sheetBoundary, bounds);

        expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(svg).toContain('<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">');
        expect(svg).toContain('<g id="Kiss-Cut" stroke="cyan" fill="none" stroke-width="1">');
        expect(svg).toContain('<g id="Die-Cut" stroke="red" fill="none" stroke-width="1">');

        // Check if the offset logic works correctly
        // layer offset x=5, y=5. Cutline point x=10, y=10. Bounds left=10, top=10.
        // Final point x = 10 + 5 - 10 = 5. y = 10 + 5 - 10 = 5.
        expect(svg).toContain('M 5 5 L 15 5 L 15 15 L 5 15 Z');

        // Check sheet boundary offset logic (should use 0 offset but still subtract bounds)
        // point x=0, y=0. Bounds left=10, top=10.
        // Final point x = 0 - 10 = -10. y = 0 - 10 = -10.
        expect(svg).toContain('M -10 -10 L 20 -10 L 20 20 L -10 20 Z');
    });

    it("should handle empty currentCutline gracefully", () => {
        const bounds = { width: 100, height: 100, left: 0, top: 0 };
        const designLayers = [{ visible: true, x: 0, y: 0, currentCutline: [] }];
        const sheetBoundary = [];

        const svg = generateMultiLayerSvg(designLayers, sheetBoundary, bounds);
        expect(svg).toContain('<g id="Kiss-Cut" stroke="cyan" fill="none" stroke-width="1">');
        expect(svg).toContain('</g>');
        expect(svg).not.toContain('<path'); // Should have no paths
    });
});
