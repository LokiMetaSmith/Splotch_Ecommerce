// /lib/svgparser.js

/*!
 * SvgParser - Modern ES Module Version
 * A library to convert an SVG string to parse-able segments for CAD/CAM use
 * Licensed under the MIT license
 */
'use strict';

import { Matrix } from './matrix.js';
import { GeometryUtil } from './geometryutil.js';

export class SVGParser {
    constructor() {
        this.svg = null;
        this.svgRoot = null;
        this.allowedElements = ['svg', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'rect', 'line'];
        this.conf = {
            tolerance: 2,      // max bound for bezier->line segment conversion
            toleranceSvg: 0.005 // fudge factor for browser inaccuracy
        };
    }

    config(config) {
        if (config && config.tolerance) {
            this.conf.tolerance = config.tolerance;
        }
    }

    load(svgString) {
        if (!svgString || typeof svgString !== 'string') {
            throw new Error('Invalid SVG string');
        }

        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgString, "image/svg+xml");

        if (!svgDoc || svgDoc.querySelector('parsererror')) {
            throw new Error("Failed to parse SVG string");
        }

        this.svg = svgDoc;
        this.svgRoot = svgDoc.querySelector('svg');

        if (!this.svgRoot) {
            throw new Error("No SVG root element found in the provided string");
        }

        return this.svgRoot;
    }

    cleanInput() {
        if (!this.svgRoot) return null;
        this.applyTransform(this.svgRoot);
        this.flatten(this.svgRoot);
        this.filter(this.allowedElements);
        return this.svgRoot;
    }

    getStyle() {
        return this.svgRoot ? this.svgRoot.querySelector('style') : false;
    }


    transformParse(transformString) {
        const CMD_SPLIT_RE = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*(.*?)\s*\)[\s,]*/;
        const PARAMS_SPLIT_RE = /[\s,]+/;
        const matrix = new Matrix();
        let cmd = '';

        transformString.split(CMD_SPLIT_RE).forEach(item => {
            if (!item || !item.length) return;
            if (['matrix', 'translate', 'scale', 'rotate', 'skewX', 'skewY'].includes(item)) {
                cmd = item;
                return;
            }

            const params = item.split(PARAMS_SPLIT_RE).map(i => +i || 0);
            switch (cmd) {
                case 'matrix': if (params.length === 6) matrix.matrix(params); break;
                case 'scale': matrix.scale(params[0], params.length > 1 ? params[1] : params[0]); break;
                case 'rotate': matrix.rotate(params[0], params[1] || 0, params[2] || 0); break;
                case 'translate': matrix.translate(params[0], params[1] || 0); break;
                case 'skewX': if (params.length === 1) matrix.skewX(params[0]); break;
                case 'skewY': if (params.length === 1) matrix.skewY(params[0]); break;
            }
        });
        return matrix;
    }

    applyTransform(element, globalTransformMatrix = new Matrix()) {
        const transformAttr = element.getAttribute('transform');
        let currentMatrix = globalTransformMatrix;

        if (transformAttr) {
            const localMatrix = this.transformParse(transformAttr);
            currentMatrix = new Matrix();
            const combined = currentMatrix.combine(globalTransformMatrix.toArray(), localMatrix.toArray());
            currentMatrix.matrix(combined);
        }

        if (['g', 'svg', 'defs'].includes(element.tagName)) {
            element.removeAttribute('transform');
            for (const child of Array.from(element.children)) {
                this.applyTransform(child, currentMatrix);
            }
        } else if (!currentMatrix.isIdentity() && this.allowedElements.includes(element.tagName) && element.tagName !== 'svg') {
            const poly = this.polygonify(element);
            const transformedPoly = poly.map(p => {
                const [x, y] = currentMatrix.calc(p.x, p.y);
                return { x, y };
            });

            if (transformedPoly.length > 0) {
                let d = transformedPoly.map((p, i) => (i === 0 ? 'M ' : 'L ') + p.x + ' ' + p.y).join(' ');
                if (element.tagName !== 'polyline' && element.tagName !== 'line') {
                    d += ' Z';
                }
                const newPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                newPath.setAttribute('d', d);

                for (const attr of element.attributes) {
                    if (!['transform', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'd', 'x1', 'y1', 'x2', 'y2'].includes(attr.name)) {
                        newPath.setAttribute(attr.name, attr.value);
                    }
                }
                if (element.parentElement) {
                    element.parentElement.replaceChild(newPath, element);
                }
            }
        } else {
            for (const child of Array.from(element.children)) {
                this.applyTransform(child, currentMatrix);
            }
        }
    }

    flatten(element) {
        if (element.tagName === 'g' && element.parentElement) {
            while (element.firstChild) {
                element.parentElement.insertBefore(element.firstChild, element);
            }
            element.parentElement.removeChild(element);
        }
        for (const child of Array.from(element.children)) {
            this.flatten(child);
        }
    }

    filter(whitelist, element = this.svgRoot) {
        const children = Array.from(element.children);
        for (const child of children) {
            this.filter(whitelist, child);
        }
        if (!whitelist.includes(element.tagName) && element.parentElement) {
            element.parentElement.removeChild(element);
        }
    }

    
    recurse(element, func) {
        const children = Array.from(element.children);
        children.forEach(child => this.recurse(child, func));
        func(element);
    }

    parsePath(d) {
        // More robust splitting to handle commands without spaces (e.g., "M0 0H100")
        // Fix: Use regex that excludes 'e' (scientific notation) from commands
        const tokens = d.replace(/([MmLlHhVvCcSsQqTtAaZz])/g, ' $1 ').trim().split(/[\s,]+/).filter(t => t.length > 0);
        const COMMAND = /([MmLlHhVvCcSsQqTtAaZz])/;

        const polygons = [];
        let currentPolygon = [];
        let cx = 0, cy = 0; // current point
        let startX = 0, startY = 0; // start of current subpath

        let command = '';
        while(tokens.length > 0) {
            let token = tokens.shift();
            const isCommand = token.match(COMMAND);
            if (isCommand) {
                command = token;
            } else {
                tokens.unshift(token); // put it back
            }

            // Helper to get the next number from tokens
            const next = () => parseFloat(tokens.shift());

            // Handle parsing errors or missing tokens
            const safeNext = () => {
                const val = next();
                return isNaN(val) ? 0 : val;
            };

            switch(command) {
                case 'M':
                    if (currentPolygon.length > 0) polygons.push(currentPolygon);
                    currentPolygon = [];
                    cx = next(); cy = next();
                    currentPolygon.push({x: cx, y: cy});
                    startX = cx; startY = cy;
                    command = 'L'; // Subsequent pairs are lineto
                    break;
                case 'm':
                    if (currentPolygon.length > 0) polygons.push(currentPolygon);
                    currentPolygon = [];
                    cx += next(); cy += next();
                    currentPolygon.push({x: cx, y: cy});
                    startX = cx; startY = cy;
                    command = 'l'; // Subsequent pairs are lineto
                    break;
                case 'L':
                    cx = next(); cy = next();
                    currentPolygon.push({x: cx, y: cy});
                    break;
                case 'l':
                    cx += next(); cy += next();
                    currentPolygon.push({x: cx, y: cy});
                    break;
                case 'H':
                    cx = next();
                    currentPolygon.push({x: cx, y: cy});
                    break;
                case 'h':
                    cx += next();
                    currentPolygon.push({x: cx, y: cy});
                    break;
                case 'V':
                    cy = next();
                    currentPolygon.push({x: cx, y: cy});
                    break;
                case 'v':
                    cy += next();
                    currentPolygon.push({x: cx, y: cy});
                    break;
                case 'Z':
                case 'z':
                    if (currentPolygon.length > 0) {
                        // Close the path by adding the starting point
                        currentPolygon.push({x: startX, y: startY});
                        polygons.push(currentPolygon);
                        currentPolygon = [];
                    }
                    // The "pen" moves back to the start of the subpath
                    cx = startX;
                    cy = startY;
                    break;
                // --- Approximating Curves as Lines ---
                case 'C': cx = next(); cy = next(); next(); next(); next(); next(); currentPolygon.push({x: cx, y: cy}); break;
                case 'c': cx += next(); cy += next(); next(); next(); next(); next(); currentPolygon.push({x: cx, y: cy}); break;
                case 'S': cx = next(); cy = next(); next(); next(); currentPolygon.push({x: cx, y: cy}); break;
                case 's': cx += next(); cy += next(); next(); next(); currentPolygon.push({x: cx, y: cy}); break;
                case 'Q': cx = next(); cy = next(); next(); next(); currentPolygon.push({x: cx, y: cy}); break;
                case 'q': cx += next(); cy += next(); next(); next(); currentPolygon.push({x: cx, y: cy}); break;
                case 'T': cx = next(); cy = next(); currentPolygon.push({x: cx, y: cy}); break;
                case 't': cx += next(); cy += next(); currentPolygon.push({x: cx, y: cy}); break;
                case 'A': cx = next(); cy = next(); next(); next(); next(); next(); next(); currentPolygon.push({x: cx, y: cy}); break;
                case 'a': cx += next(); cy += next(); next(); next(); next(); next(); next(); currentPolygon.push({x: cx, y: cy}); break;

                default:
                    // If we encounter an unknown command, we stop parsing this path
                    console.warn(`Unsupported SVG path command: ${command}`);
                    if (currentPolygon.length > 0) polygons.push(currentPolygon);
                    return polygons;
            }
        }
        if (currentPolygon.length > 0) {
            polygons.push(currentPolygon);
        }
        return polygons;
    }

    polygonify(element) {
        let poly = []; // Use let since it can be reassigned
        switch (element.tagName) {
            case 'polygon':
            case 'polyline':
                for (let i = 0; i < element.points.length; i++) {
                    const point = element.points.getItem(i);
                    poly.push({ x: point.x, y: point.y });
                }
                break;
            case 'rect':
                const x = parseFloat(element.getAttribute('x')) || 0;
                const y = parseFloat(element.getAttribute('y')) || 0;
                const width = parseFloat(element.getAttribute('width'));
                const height = parseFloat(element.getAttribute('height'));
                poly.push({ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height });
                break;
            case 'circle':
            case 'ellipse':
                const cx = parseFloat(element.getAttribute('cx'));
                const cy = parseFloat(element.getAttribute('cy'));
                const rx = parseFloat(element.getAttribute('rx') || element.getAttribute('r'));
                const ry = parseFloat(element.getAttribute('ry') || element.getAttribute('r'));
                const numSegments = Math.ceil((2 * Math.PI) / Math.acos(1 - (this.conf.tolerance / Math.max(rx, ry))));
                
                for (let i = 0; i < Math.max(numSegments, 3); i++) {
                    const theta = i * (2 * Math.PI) / numSegments;
                    poly.push({
                        x: rx * Math.cos(theta) + cx,
                        y: ry * Math.sin(theta) + cy
                    });
                }
                break;
            case 'line':
                const x1 = parseFloat(element.getAttribute('x1')) || 0;
                const y1 = parseFloat(element.getAttribute('y1')) || 0;
                const x2 = parseFloat(element.getAttribute('x2')) || 0;
                const y2 = parseFloat(element.getAttribute('y2')) || 0;
                poly.push({ x: x1, y: y1 }, { x: x2, y: y2 });
                break;
            case 'path':
                const d = element.getAttribute('d');
                if (d) {
                    // A path can contain multiple sub-paths, so parsePath returns an array of polygons.
                    // For the purpose of this function, we'll return the first one.
                    // A more robust implementation might handle multiple polygons differently.
                    const polygons = this.parsePath(d);
                    if (polygons.length > 0) {
                        poly = polygons[0]; // Return the first polygon
                    }
                }
                break;
        }
        
        // Remove last point if it's the same as the first
        if (poly.length > 1 && 
            GeometryUtil.almostEqual(poly[0].x, poly[poly.length - 1].x, this.conf.toleranceSvg) && 
            GeometryUtil.almostEqual(poly[0].y, poly[poly.length - 1].y, this.conf.toleranceSvg)) {
            poly.pop();
        }
        
        return poly;
    }
}