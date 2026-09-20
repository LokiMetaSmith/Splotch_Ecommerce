/**
 * @jest-environment jsdom
 */

import { generateCutFile } from '../../src/lib/cut_file_generator.js';

describe('generateCutFile', () => {
    test('should copy dimensions and viewBox', () => {
        const svgString = '<svg width="100" height="100" viewBox="0 0 100 100"></svg>';
        const result = generateCutFile(svgString);

        const parser = new DOMParser();
        const doc = parser.parseFromString(result, 'image/svg+xml');
        const svg = doc.documentElement;

        expect(svg.getAttribute('width')).toBe('100');
        expect(svg.getAttribute('height')).toBe('100');
        expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
    });

    test('should clone shapes with red stroke and no fill', () => {
        const svgString = `
            <svg width="100" height="100" viewBox="0 0 100 100">
                <rect x="10" y="10" width="80" height="80" fill="blue" stroke="black" />
                <circle cx="50" cy="50" r="40" fill="green" />
            </svg>
        `;
        const result = generateCutFile(svgString);

        const parser = new DOMParser();
        const doc = parser.parseFromString(result, 'image/svg+xml');
        const rect = doc.querySelector('rect');
        const circle = doc.querySelector('circle');

        expect(rect).toBeTruthy();
        expect(rect.getAttribute('x')).toBe('10');
        expect(rect.getAttribute('fill')).toBe('none');
        expect(rect.getAttribute('stroke')).toBe('red');

        expect(circle).toBeTruthy();
        expect(circle.getAttribute('cx')).toBe('50');
        expect(circle.getAttribute('fill')).toBe('none');
        expect(circle.getAttribute('stroke')).toBe('red');
    });

    test('should handle multiple shapes', () => {
         const svgString = `
            <svg width="100" height="100" viewBox="0 0 100 100">
                <path d="M10 10 L90 90" />
                <ellipse cx="50" cy="50" rx="40" ry="20" />
                <polygon points="10,10 20,20 30,10" />
                <polyline points="10,80 20,90 30,80" />
            </svg>
        `;
        const result = generateCutFile(svgString);

        const parser = new DOMParser();
        const doc = parser.parseFromString(result, 'image/svg+xml');

        expect(doc.querySelectorAll('path').length).toBe(1);
        expect(doc.querySelectorAll('ellipse').length).toBe(1);
        expect(doc.querySelectorAll('polygon').length).toBe(1);
        expect(doc.querySelectorAll('polyline').length).toBe(1);

        doc.querySelectorAll('*').forEach(el => {
            if (el.tagName !== 'svg') {
                 expect(el.getAttribute('stroke')).toBe('red');
                 expect(el.getAttribute('fill')).toBe('none');
            }
        });
    });

    test('should preserve nested transforms and ignore fiducial marks on nested sheets', () => {
        const nestedSvgString = `
            <svg width="500" height="500" viewBox="0 0 500 500">
                <circle cx="60" cy="60" r="12" fill="black" />
                <g class="nest-group" transform="translate(150 200) rotate(15)" data-scale="0.5">
                    <image href="data:image/png;base64,mock" width="100" height="100" />
                    <g id="Kiss-Cut" class="cut-line-element">
                        <path d="M 10 10 L 90 90 Z" />
                    </g>
                </g>
            </svg>
        `;
        const result = generateCutFile(nestedSvgString);

        const parser = new DOMParser();
        const doc = parser.parseFromString(result, 'image/svg+xml');

        // Fiducial circle must NOT be present in cut file
        expect(doc.querySelector('circle')).toBeNull();

        // Transform must be preserved on the group
        const group = doc.querySelector('g[transform="translate(150 200) rotate(15)"]');
        expect(group).toBeTruthy();
        expect(group.getAttribute('data-scale')).toBe('0.5');

        // Cut path inside must have stroke red and fill none
        const path = group.querySelector('path');
        expect(path).toBeTruthy();
        expect(path.getAttribute('stroke')).toBe('red');
        expect(path.getAttribute('fill')).toBe('none');
    });

    test('should apply custom kissCutColor and edgeCutColor based on element classification', () => {
        const nestedSvgString = `
            <svg width="500" height="500" viewBox="0 0 500 500">
                <g class="nest-group" transform="translate(100 100)">
                    <image href="data:image/png;base64,mock" width="100" height="100" />
                    <g id="Kiss-Cut" class="cut-line-element">
                        <path d="M 10 10 L 90 90 Z" />
                    </g>
                    <g id="Die-Cut" class="cut-line-element">
                        <path d="M 0 0 L 100 100 Z" />
                    </g>
                </g>
            </svg>
        `;
        const result = generateCutFile(nestedSvgString, {
            kissCutColor: '#00FFFF',
            edgeCutColor: '#FF0000'
        });

        const parser = new DOMParser();
        const doc = parser.parseFromString(result, 'image/svg+xml');

        const kissPath = doc.querySelector('#Kiss-Cut path');
        const diePath = doc.querySelector('#Die-Cut path');

        expect(kissPath).toBeTruthy();
        expect(kissPath.getAttribute('stroke')).toBe('#00FFFF');
        expect(kissPath.getAttribute('fill')).toBe('none');

        expect(diePath).toBeTruthy();
        expect(diePath.getAttribute('stroke')).toBe('#FF0000');
        expect(diePath.getAttribute('fill')).toBe('none');
    });
});

