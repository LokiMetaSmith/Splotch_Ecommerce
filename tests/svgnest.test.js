import { describe, it, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';
import { SVGParser } from '../src/lib/svgparser.js';
import { PlacementWorker } from '../src/lib/placementworker.js';
import { GeometryUtil } from '../src/lib/geometryutil.js';
import { SvgNest } from '../src/lib/svgnest.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock JSDOM for SVG manipulation
const dom = new JSDOM('<!DOCTYPE html>');
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
global.navigator = { userAgent: 'node' };
global.self = global;

// Load ClipperLib globally as required by svgnest.js/placementworker.js
const clipperPath = path.resolve(__dirname, '../src/lib/clipper.js');
const clipperContent = fs.readFileSync(clipperPath, 'utf8');

// Ensure ClipperLib is attached to window
window.ClipperLib = null; // Initialize
// Hack to make clipper.js write to window.ClipperLib
const clipperScript = `
    (function() {
        ${clipperContent}
    })();
`;
// Evaluate in context of window
try {
    // If clipper.js checks for document/window, it should attach to window.ClipperLib
    eval(clipperContent);
} catch (e) {
    console.error("Clipper eval failed", e);
}

// Fallback if it attached to 'self' or 'this'
if (!window.ClipperLib && global.ClipperLib) {
    window.ClipperLib = global.ClipperLib;
}
if (!window.ClipperLib && self.ClipperLib) {
    window.ClipperLib = self.ClipperLib;
}

describe('SVGParser', () => {
    let parser;

    beforeEach(() => {
        parser = new SVGParser();
    });

    it('should parse standard path data', () => {
        const d = "M0 0 L100 0 L100 100 L0 100 Z";
        const polygons = parser.parsePath(d);
        expect(polygons.length).toBe(1);
        expect(polygons[0].length).toBe(5); // 4 points + close
        expect(polygons[0][0]).toEqual({ x: 0, y: 0 });
        expect(polygons[0][2]).toEqual({ x: 100, y: 100 });
    });

    it('should parse compact path data (no spaces between command and number)', () => {
        const d = "M0 0H100V100H0Z";
        const polygons = parser.parsePath(d);
        expect(polygons.length).toBe(1);
        expect(polygons[0].length).toBe(5);
        expect(polygons[0][1]).toEqual({ x: 100, y: 0 }); // H100
        expect(polygons[0][2]).toEqual({ x: 100, y: 100 }); // V100
    });
});

describe('PlacementWorker', () => {
    // PlacementWorker relies on window.ClipperLib
    beforeAll(() => {
        if (!window.ClipperLib) {
            window.ClipperLib = global.ClipperLib;
        }
    });

    it('should place a simple rect in a bin', () => {
        // Bin: 1000x1000
        const bin = [{x:0, y:0}, {x:1000, y:0}, {x:1000, y:1000}, {x:0, y:1000}];
        // Part: 100x100
        const part = [{x:0, y:0}, {x:100, y:0}, {x:100, y:100}, {x:0, y:100}];

        const worker = new PlacementWorker(bin, [part], [0], [0], { spacing: 0 }, {});
        const result = worker.placePaths([part]);

        expect(result).not.toBeNull();
        expect(result.placements).toHaveLength(1);
        expect(result.placements[0]).toHaveLength(1);
        const p = result.placements[0][0];
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
    });

    it('should avoid overlapping parts', () => {
        // Bin: 200x100
        const bin = [{x:0, y:0}, {x:200, y:0}, {x:200, y:100}, {x:0, y:100}];
        // Part: 100x100
        const part = [{x:0, y:0}, {x:100, y:0}, {x:100, y:100}, {x:0, y:100}];
        // Two parts, same ID (0)
        const parts = [part];
        const ids = [0, 0];
        const rotations = [0, 0];

        const worker = new PlacementWorker(bin, parts, ids, rotations, { spacing: 0 }, {});
        // Passing duplicated parts array to simulate multiple items
        const result = worker.placePaths([part, part]);

        expect(result.placements[0]).toHaveLength(2);
        const p1 = result.placements[0][0];
        const p2 = result.placements[0][1];

        // p1 should be at 0,0
        expect(p1.x).toBe(0);
        expect(p1.y).toBe(0);

        // p2 should be shifted to 100,0 (since width is 100)
        // With step=20, it might be 100 or 120 depending on spacing
        expect(p2.x).toBeGreaterThanOrEqual(100);
        expect(p2.y).toBe(0);
    });
});

describe('SvgNest', () => {
    let nest;

    beforeAll(() => {
        // Mock JSDOM things if needed
    });

    it('should find parts in nested groups', () => {
        // We need a DOM element structure
        const parser = new window.DOMParser();
        const svgString = `
            <svg>
                <g>
                    <rect x="0" y="0" width="50" height="50" />
                </g>
                <g>
                    <g>
                        <circle cx="25" cy="25" r="25" />
                    </g>
                </g>
            </svg>
        `;
        const doc = parser.parseFromString(svgString, "image/svg+xml");
        const svg = doc.documentElement;

        // Mock SvgNest dependencies
        nest = new SvgNest(null, [], {});

        const parts = nest._getParts([svg]);
        // Should find 2 parts (rect and circle)
        expect(parts.length).toBe(2);
    });
});
