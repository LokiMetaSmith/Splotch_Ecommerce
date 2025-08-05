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
        this.recurse(this.svgRoot, (el) => this.splitPath(el));
        return this.svgRoot;
    }

    getStyle() {
        return this.svgRoot ? this.svgRoot.querySelector('style') : false;
    }

    /**
     * NOTE: This method relies on the `pathSegList` API, which is deprecated in modern browsers
     * and has been removed from Chrome and Firefox. It may not function as expected.
     * A robust solution requires a proper path data parser.
     */
    pathToAbsolute(path) {
        if (!path || path.tagName !== 'path' || !path.pathSegList) {
            console.warn("SvgParser.pathToAbsolute: pathSegList API is deprecated and may not be supported.");
            return;
        }

        let x = 0, y = 0, x0 = 0, y0 = 0;
        const seglist = path.pathSegList;

        for (let i = 0; i < seglist.numberOfItems; i++) {
            const s = seglist.getItem(i);
            const command = s.pathSegTypeAsLetter;

            if (/[MLHVCSQTA]/.test(command)) {
                if ('x' in s) x = s.x;
                if ('y' in s) y = s.y;
            } else {
                let x1 = 'x1' in s ? x + s.x1 : 0;
                let y1 = 'y1' in s ? y + s.y1 : 0;
                let x2 = 'x2' in s ? x + s.x2 : 0;
                let y2 = 'y2' in s ? y + s.y2 : 0;
                if ('x' in s) x += s.x;
                if ('y' in s) y += s.y;

                switch (command) {
                    case 'm': seglist.replaceItem(path.createSVGPathSegMovetoAbs(x, y), i); break;
                    case 'l': seglist.replaceItem(path.createSVGPathSegLinetoAbs(x, y), i); break;
                    case 'h': seglist.replaceItem(path.createSVGPathSegLinetoHorizontalAbs(x), i); break;
                    case 'v': seglist.replaceItem(path.createSVGPathSegLinetoVerticalAbs(y), i); break;
                    case 'c': seglist.replaceItem(path.createSVGPathSegCurvetoCubicAbs(x, y, x1, y1, x2, y2), i); break;
                    case 's': seglist.replaceItem(path.createSVGPathSegCurvetoCubicSmoothAbs(x, y, x2, y2), i); break;
                    case 'q': seglist.replaceItem(path.createSVGPathSegCurvetoQuadraticAbs(x, y, x1, y1), i); break;
                    case 't': seglist.replaceItem(path.createSVGPathSegCurvetoQuadraticSmoothAbs(x, y), i); break;
                    case 'a': seglist.replaceItem(path.createSVGPathSegArcAbs(x, y, s.r1, s.r2, s.angle, s.largeArcFlag, s.sweepFlag), i); break;
                    case 'z': case 'Z': x = x0; y = y0; break;
                }
            }
            if (command.toUpperCase() === 'M') {
                x0 = x;
                y0 = y;
            }
        }
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
            // Combine matrices by creating a new matrix from the arrays
            currentMatrix = new Matrix();
            const combined = currentMatrix.combine(globalTransformMatrix.toArray(), localMatrix.toArray());
            currentMatrix.matrix(combined);
        }

        if (['g', 'svg', 'defs'].includes(element.tagName)) {
            element.removeAttribute('transform');
        } else if (!currentMatrix.isIdentity()) {
             // A robust implementation requires converting shapes to paths and applying matrix math.
             // This is a complex task beyond simple attribute changes for accurate transforms.
             console.warn(`Applying transform to <${element.tagName}>. For full accuracy, convert shape to path first.`);
             element.removeAttribute('transform');
        }

        for (const child of Array.from(element.children)) {
            this.applyTransform(child, currentMatrix);
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

    splitPath(path) {
        if (path.tagName !== 'path' || !path.parentElement || !path.pathSegList) return;

        const seglist = Array.from(path.pathSegList);
        if (seglist.filter(s => s.pathSegTypeAsLetter.toUpperCase() === 'M').length <= 1) {
            return; // No subpaths to split
        }
        
        const subpaths = [];
        let currentPath = null;
        
        seglist.forEach(seg => {
            const command = seg.pathSegTypeAsLetter;
            if (command.toUpperCase() === 'M') {
                currentPath = path.cloneNode(false);
                currentPath.setAttribute('d', '');
                for(const attr of path.attributes){
                    if(attr.name !== 'd'){
                        currentPath.setAttribute(attr.name, attr.value);
                    }
                }
                subpaths.push(currentPath);
            }
            currentPath.pathSegList.appendItem(seg);
        });

        subpaths.forEach(p => path.parentElement.insertBefore(p, path));
        path.parentElement.removeChild(path);
    }
    
    recurse(element, func) {
        const children = Array.from(element.children);
        children.forEach(child => this.recurse(child, func));
        func(element);
    }

    polygonify(element) {
        const poly = [];
        switch (element.tagName) {
            case 'polygon':
            case 'polyline':
                for (const point of element.points) {
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
            case 'path':
                // Linearizing paths requires the GeometryUtil library and a path data parser
                // since pathSegList is deprecated. This is a placeholder for that complex logic.
                console.warn("Polygonify for <path> elements is complex and not fully implemented in this version.");
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