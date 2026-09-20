export function generateCutFile(svgString, options = {}) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgElement = doc.documentElement;
    const cutFileSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (svgElement.hasAttribute('width')) cutFileSvg.setAttribute('width', svgElement.getAttribute('width'));
    if (svgElement.hasAttribute('height')) cutFileSvg.setAttribute('height', svgElement.getAttribute('height'));
    if (svgElement.hasAttribute('viewBox')) cutFileSvg.setAttribute('viewBox', svgElement.getAttribute('viewBox'));

    const kissColor = options.kissCutColor || options.cutColor || "red";
    const edgeColor = options.edgeCutColor || options.cutColor || "red";

    const classifyType = (el) => {
        const id = (el.getAttribute('id') || '').toLowerCase();
        const pId = (el.parentElement?.getAttribute('id') || '').toLowerCase();
        const cls = (el.getAttribute('class') || '').toLowerCase();
        if (id.includes('die') || id.includes('perf') || id.includes('edge') || pId.includes('die') || pId.includes('perf') || pId.includes('edge') || cls.includes('die')) {
            return 'edge';
        }
        if (id.includes('kiss') || pId.includes('kiss') || cls.includes('kiss')) {
            return 'kiss';
        }
        return 'kiss';
    };

    const nestGroups = svgElement.querySelectorAll('.nest-group');
    if (nestGroups.length > 0) {
        nestGroups.forEach(nestGroup => {
            const cutSubGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            if (nestGroup.hasAttribute('transform')) cutSubGroup.setAttribute('transform', nestGroup.getAttribute('transform'));
            if (nestGroup.hasAttribute('data-scale')) cutSubGroup.setAttribute('data-scale', nestGroup.getAttribute('data-scale'));

            let cutEls = Array.from(nestGroup.querySelectorAll('.cut-line-element, [id*="kiss" i], [id*="die" i]'));
            if (cutEls.length === 0) {
                cutEls = Array.from(nestGroup.querySelectorAll('path, polygon, polyline'));
            }

            const validCutEls = cutEls.filter(el => {
                if (el.tagName.toLowerCase() === 'image') return false;
                const parentId = (el.parentElement?.getAttribute('id') || '').toLowerCase();
                if (parentId.includes('cmyk') || parentId.includes('white') || parentId.includes('inlay') || parentId.includes('clear')) {
                    return false;
                }
                return true;
            });

            // Avoid double-selecting nested children
            const topCutEls = validCutEls.filter(el => !validCutEls.some(other => other !== el && other.contains(el)));

            topCutEls.forEach(el => {
                const type = classifyType(el);
                const strokeColor = type === 'edge' ? edgeColor : kissColor;
                const clone = el.cloneNode(true);
                const paths = clone.tagName.toLowerCase() === 'g'
                    ? clone.querySelectorAll('path, polygon, polyline, rect, circle, ellipse')
                    : [clone];
                paths.forEach(p => {
                    p.setAttribute('stroke', strokeColor);
                    p.setAttribute('fill', 'none');
                });
                cutSubGroup.appendChild(clone);
            });

            if (cutSubGroup.childNodes.length > 0) {
                cutFileSvg.appendChild(cutSubGroup);
            }
        });
    } else {
        // Flat SVG fallback
        svgElement.querySelectorAll('path, rect, circle, ellipse, polygon, polyline').forEach(el => {
            const type = classifyType(el);
            const strokeColor = type === 'edge' ? edgeColor : kissColor;
            const newEl = el.cloneNode(true);
            newEl.setAttribute('stroke', strokeColor);
            newEl.setAttribute('fill', 'none');
            cutFileSvg.appendChild(newEl);
        });
    }

    return new XMLSerializer().serializeToString(cutFileSvg);
}

export function generatePltFile(svgString, options = {}) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgElement = doc.documentElement;
    
    // Create a temporary container in the live DOM so getCTM and getPointAtLength work
    const tempDiv = document.createElement('div');
    tempDiv.style.visibility = 'hidden';
    tempDiv.style.position = 'absolute';
    tempDiv.appendChild(svgElement);
    document.body.appendChild(tempDiv);
    
    // Scale factor: 96 DPI -> 1016 HPGL units per inch
    const scale = 1016 / 96;
    
    let height = 0;
    if (svgElement.hasAttribute('viewBox')) {
        const parts = svgElement.getAttribute('viewBox').split(/[\s,]+/);
        height = parseFloat(parts[3]);
    } else {
        height = parseFloat(svgElement.getAttribute('height') || '1000');
    }

    let hpgl = "IN;\n"; // Initialize
    
    if (options.mediaType) {
        hpgl += `CO Media: ${options.mediaType};\n`;
    }
    if (options.thickness) {
        hpgl += `CO Thickness: ${options.thickness}mm;\n`;
    }
    if (options.cutType) {
        hpgl += `CO CutType: ${options.cutType};\n`;
    }
    if (options.cutPressure) {
        hpgl += `FS${options.cutPressure};\n`; // Force Select command
    }
    
    let elements = [];
    const nestGroups = svgElement.querySelectorAll('.nest-group');
    if (nestGroups.length > 0) {
        nestGroups.forEach(nestGroup => {
            let cutEls = Array.from(nestGroup.querySelectorAll('.cut-line-element, [id*="kiss" i] path, [id*="die" i] path'));
            if (cutEls.length === 0) {
                cutEls = Array.from(nestGroup.querySelectorAll('path, polygon, polyline'));
            }
            cutEls.forEach(el => {
                const parentId = (el.parentElement?.getAttribute('id') || '').toLowerCase();
                if (!parentId.includes('cmyk') && !parentId.includes('white') && !parentId.includes('inlay') && !parentId.includes('clear') && el.tagName.toLowerCase() !== 'image') {
                    elements.push(el);
                }
            });
        });
    } else {
        elements = Array.from(svgElement.querySelectorAll('path, rect, circle, ellipse, polygon, polyline'));
    }
    
    elements.forEach(el => {
        let points = [];
        const tagName = el.tagName.toLowerCase();

        if (tagName === 'polygon' || tagName === 'polyline') {
            const ptsStr = el.getAttribute('points');
            if (ptsStr) {
                const pts = ptsStr.trim().split(/[\s,]+/).map(Number);
                for (let i = 0; i < pts.length; i += 2) {
                    points.push({ x: pts[i], y: pts[i+1] });
                }
                if (tagName === 'polygon' && points.length > 0) {
                    points.push({ x: points[0].x, y: points[0].y });
                }
            }
        } else if (tagName === 'rect') {
            const x = parseFloat(el.getAttribute('x') || 0);
            const y = parseFloat(el.getAttribute('y') || 0);
            const w = parseFloat(el.getAttribute('width') || 0);
            const h = parseFloat(el.getAttribute('height') || 0);
            points.push({x, y}, {x: x+w, y}, {x: x+w, y: y+h}, {x, y: y+h}, {x, y});
        } else if (tagName === 'circle') {
            const cx = parseFloat(el.getAttribute('cx') || 0);
            const cy = parseFloat(el.getAttribute('cy') || 0);
            const r = parseFloat(el.getAttribute('r') || 0);
            const segments = 32;
            for (let i = 0; i <= segments; i++) {
                const theta = (i / segments) * 2 * Math.PI;
                points.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
            }
        } else if (tagName === 'path') {
            try {
                const length = el.getTotalLength();
                // sample every ~1 pixel for high resolution
                const segments = Math.max(2, Math.ceil(length));
                for (let i = 0; i <= segments; i++) {
                    const l = (i / segments) * length;
                    const pt = el.getPointAtLength(l);
                    points.push({ x: pt.x, y: pt.y });
                }
            } catch (e) {
                console.error("Error calculating path length", e);
            }
        }
        
        // Write HPGL for these points
        if (points.length > 0) {
            // Apply CTM to convert from local to SVG coordinate space
            const ctm = el.getCTM();
            const svgPt = svgElement.createSVGPoint();

            hpgl += "PU;\n";
            let first = true;
            points.forEach(pt => {
                svgPt.x = pt.x;
                svgPt.y = pt.y;
                let transformedPt = pt;
                if (ctm) {
                    transformedPt = svgPt.matrixTransform(ctm);
                }

                // Invert Y axis for plotter (origin bottom-left)
                const hpglX = Math.round(transformedPt.x * scale);
                const hpglY = Math.round((height - transformedPt.y) * scale);
                if (first) {
                    hpgl += `PA${hpglX},${hpglY};\nPD;\n`;
                    first = false;
                } else {
                    hpgl += `PA${hpglX},${hpglY};\n`;
                }
            });
            hpgl += "PU;\n";
        }
    });

    document.body.removeChild(tempDiv);
    return hpgl;
}
