/**
 * @jest-environment jsdom
 */
import { SVGParser } from '../src/lib/svgparser.js';
import { GeometryUtil } from '../src/lib/geometryutil.js';
import { Matrix } from '../src/lib/matrix.js';

describe('Image Transformation and Editing', () => {
    describe('SVGParser', () => {
        it('should load and clean an SVG string', () => {
            const svgString = '<svg width="100" height="100"><rect x="10" y="10" width="80" height="80" /></svg>';
            const parser = new SVGParser();

            const svgRoot = parser.load(svgString);
            expect(svgRoot).not.toBeNull();
            expect(svgRoot.tagName).toBe('svg');

            const cleanedSvg = parser.cleanInput();
            expect(cleanedSvg).not.toBeNull();
        });

        it('should throw an error for invalid SVG string', () => {
            const parser = new SVGParser();
            // JSDOM might not throw a parsererror for any random string, but for a malformed XML it should.
            expect(() => parser.load('<svg><rect></svg>')).toThrow("Failed to parse SVG string");
        });

        it('should throw an error for empty SVG string', () => {
            const parser = new SVGParser();
            expect(() => parser.load('')).toThrow('Invalid SVG string');
        });

        it('should throw an error for SVG string without an svg root', () => {
            const parser = new SVGParser();
            expect(() => parser.load('<rect x="10" y="10" width="80" height="80" />')).toThrow('No SVG root element found in the provided string');
        });
    });
    describe('Matrix', () => {
        it('should translate a point', () => {
            const matrix = new Matrix();
            matrix.translate(5, 10);
            const [x, y] = matrix.calc(10, 10);
            expect(x).toBe(15);
            expect(y).toBe(20);
        });

        it('should scale a point', () => {
            const matrix = new Matrix();
            matrix.scale(2, 3);
            const [x, y] = matrix.calc(10, 10);
            expect(x).toBe(20);
            expect(y).toBe(30);
        });

        it('should rotate a point', () => {
            const matrix = new Matrix();
            matrix.rotate(90, 0, 0);
            const [x, y] = matrix.calc(10, 0);
            expect(x).toBeCloseTo(0);
            expect(y).toBeCloseTo(10);
        });

        it('should skew a point in the x-direction', () => {
            const matrix = new Matrix();
            matrix.skewX(45);
            const [x, y] = matrix.calc(10, 10);
            expect(x).toBeCloseTo(20);
            expect(y).toBeCloseTo(10);
        });

        it('should skew a point in the y-direction', () => {
            const matrix = new Matrix();
            matrix.skewY(45);
            const [x, y] = matrix.calc(10, 10);
            expect(x).toBeCloseTo(10);
            expect(y).toBeCloseTo(20);
        });

        it('should combine transformations', () => {
            const matrix = new Matrix();
            matrix.translate(5, 10).scale(2, 3);
            const [x, y] = matrix.calc(10, 10);
            expect(x).toBe(25);
            expect(y).toBe(40);
        });
    });
    describe('polygonify', () => {
        let parser;

        beforeEach(() => {
            parser = new SVGParser();
        });

        it('should convert a rect to a polygon', () => {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', '10');
            rect.setAttribute('y', '20');
            rect.setAttribute('width', '100');
            rect.setAttribute('height', '50');
            const poly = parser.polygonify(rect);
            expect(poly.length).toBe(4);
            expect(poly[0]).toEqual({ x: 10, y: 20 });
            expect(poly[1]).toEqual({ x: 110, y: 20 });
            expect(poly[2]).toEqual({ x: 110, y: 70 });
            expect(poly[3]).toEqual({ x: 10, y: 70 });
        });

        it('should convert a circle to a polygon', () => {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', '50');
            circle.setAttribute('cy', '50');
            circle.setAttribute('r', '40');
            const poly = parser.polygonify(circle);
            // The number of segments is calculated based on the tolerance.
            // I'll just check that it has a reasonable number of points
            // and that the points are on the circle.
            expect(poly.length).toBeGreaterThan(10);
            for (const point of poly) {
                const dx = point.x - 50;
                const dy = point.y - 50;
                const dist = Math.sqrt(dx * dx + dy * dy);
                expect(dist).toBeCloseTo(40);
            }
        });

        it('should convert an ellipse to a polygon', () => {
            const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
            ellipse.setAttribute('cx', '50');
            ellipse.setAttribute('cy', '50');
            ellipse.setAttribute('rx', '40');
            ellipse.setAttribute('ry', '20');
            const poly = parser.polygonify(ellipse);
            expect(poly.length).toBeGreaterThan(10);
            for (const point of poly) {
                const dx = point.x - 50;
                const dy = point.y - 50;
                const dist = Math.sqrt((dx * dx) / (40 * 40) + (dy * dy) / (20 * 20));
                expect(dist).toBeCloseTo(1);
            }
        });

        it('should convert a polygon to a polygon', () => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M 10 10 L 100 10 L 100 100 L 10 100 Z');
            const poly = parser.polygonify(path);
            expect(poly.length).toBe(4);
            expect(poly[0]).toEqual({ x: 10, y: 10 });
            expect(poly[1]).toEqual({ x: 100, y: 10 });
            expect(poly[2]).toEqual({ x: 100, y: 100 });
            expect(poly[3]).toEqual({ x: 10, y: 100 });
        });
    });
    describe('applyTransform', () => {
        let parser;

        beforeEach(() => {
            parser = new SVGParser();
        });

        it('should apply a translate transform to a rect', () => {
            const svgString = '<svg><rect x="10" y="10" width="80" height="80" transform="translate(10, 20)" /></svg>';
            const svgRoot = parser.load(svgString);
            parser.applyTransform(svgRoot);
            const path = svgRoot.querySelector('path');
            expect(path).not.toBeNull();
            const poly = parser.polygonify(path);
            const bounds = GeometryUtil.getPolygonBounds(poly);
            expect(bounds.x).toBeCloseTo(20);
            expect(bounds.y).toBeCloseTo(30);
            expect(bounds.width).toBeCloseTo(80);
            expect(bounds.height).toBeCloseTo(80);
        });

        it('should apply a scale transform to a rect', () => {
            const svgString = '<svg><rect x="10" y="10" width="80" height="80" transform="scale(2, 0.5)" /></svg>';
            const svgRoot = parser.load(svgString);
            parser.applyTransform(svgRoot);
            const path = svgRoot.querySelector('path');
            expect(path).not.toBeNull();
            const poly = parser.polygonify(path);
            const bounds = GeometryUtil.getPolygonBounds(poly);
            expect(bounds.x).toBeCloseTo(20);
            expect(bounds.y).toBeCloseTo(5);
            expect(bounds.width).toBeCloseTo(160);
            expect(bounds.height).toBeCloseTo(40);
        });

        it('should apply a rotate transform to a rect', () => {
            const svgString = '<svg><rect x="0" y="0" width="10" height="10" transform="rotate(90)" /></svg>';
            const svgRoot = parser.load(svgString);
            parser.applyTransform(svgRoot);
            const path = svgRoot.querySelector('path');
            expect(path).not.toBeNull();
            const poly = parser.polygonify(path);
            const bounds = GeometryUtil.getPolygonBounds(poly);
            expect(bounds.x).toBeCloseTo(-10);
            expect(bounds.y).toBeCloseTo(0);
            expect(bounds.width).toBeCloseTo(10);
            expect(bounds.height).toBeCloseTo(10);
        });
    });
});
