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
});
