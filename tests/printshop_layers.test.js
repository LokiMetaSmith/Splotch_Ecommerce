/** @jest-environment jsdom */
import { describe, it, expect, beforeAll, jest } from '@jest/globals';

// Mocks for browser/crypto libraries used in printshop.js
jest.unstable_mockModule('jose', () => ({}));
jest.unstable_mockModule('jspdf', () => ({ jsPDF: jest.fn() }));
jest.unstable_mockModule('svg2pdf.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('html5-qrcode', () => ({ Html5Qrcode: jest.fn() }));
jest.unstable_mockModule('@simplewebauthn/browser', () => ({
  startRegistration: jest.fn(),
  startAuthentication: jest.fn()
}));

const { prepareVectorPrintCutSvg } = await import('../src/printshop.js');
const { generateCutFile } = await import('../src/lib/cut_file_generator.js');

describe('Print Shop Layer Ordering & Bleed Separation', () => {
  it('strictly coalesces all White_Layer elements before Cmyk_art_Layer elements', () => {
    const parser = new DOMParser();
    const svgStr = `
      <svg width="600" height="400" viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg">
        <defs><style>.mark{stroke:black}</style></defs>
        <g class="nest-group" transform="translate(10, 20)">
          <path id="White_Layer" d="M0 0h100v100H0Z" fill="white"/>
          <image href="sticker1.png" width="100" height="100"/>
          <path id="Kiss-Cut" d="M5 5h90v90H5Z"/>
          <path id="Die-Cut" d="M0 0h100v100H0Z"/>
        </g>
        <g class="nest-group" transform="translate(150, 20)">
          <path id="White_Layer" d="M0 0h100v100H0Z" fill="white"/>
          <image href="sticker2.png" width="100" height="100"/>
          <path id="Kiss-Cut" d="M5 5h90v90H5Z"/>
          <path id="Die-Cut" d="M0 0h100v100H0Z"/>
        </g>
        <path id="crop-mark-1" d="M0 0L20 20" stroke="black"/>
      </svg>
    `;

    const svgElement = parser.parseFromString(svgStr, 'image/svg+xml').documentElement;
    const cutSettings = {
      kissCutLayerName: 'Kiss-Cut',
      kissCutColor: '#00FFFF',
      edgeCutLayerName: 'Die-Cut',
      edgeCutColor: '#FF0000'
    };

    const organized = prepareVectorPrintCutSvg(svgElement, cutSettings);

    const childIds = Array.from(organized.children).map(c => c.getAttribute('id') || c.tagName.toLowerCase());

    // 1. Defs must remain first
    expect(childIds[0]).toBe('defs');

    // 2. White_Layer must be placed before Cmyk_art_Layer
    const whiteIndex = childIds.indexOf('White_Layer');
    const cmykIndex = childIds.indexOf('Cmyk_art_Layer');
    const kissIndex = childIds.indexOf('Kiss-Cut');
    const dieIndex = childIds.indexOf('Die-Cut');

    expect(whiteIndex).toBeGreaterThan(-1);
    expect(cmykIndex).toBeGreaterThan(-1);
    expect(kissIndex).toBeGreaterThan(-1);
    expect(dieIndex).toBeGreaterThan(-1);

    expect(whiteIndex).toBeLessThan(cmykIndex);
    expect(cmykIndex).toBeLessThan(kissIndex);
    expect(kissIndex).toBeLessThan(dieIndex);

    // 3. All white elements from all nested stickers are inside White_Layer
    const whiteLayer = organized.querySelector('#White_Layer');
    expect(whiteLayer.querySelectorAll('[id="White_Layer"]').length).toBe(2);

    // 4. All CMYK images from all nested stickers are inside Cmyk_art_Layer
    const cmykLayer = organized.querySelector('#Cmyk_art_Layer');
    expect(cmykLayer.querySelectorAll('image').length).toBe(2);

    // 5. No White_Layer exists inside Cmyk_art_Layer or cut layers
    expect(cmykLayer.querySelector('[id="White_Layer"]')).toBeNull();

    // 6. Cutlines are properly styled
    const kissLayer = organized.querySelector('#Kiss-Cut');
    expect(kissLayer.querySelector('path').getAttribute('stroke')).toBe('#00FFFF');

    const dieLayer = organized.querySelector('#Die-Cut');
    expect(dieLayer.querySelector('path').getAttribute('stroke')).toBe('#FF0000');

    // 7. Crop marks remain at the top
    const cropMarkIndex = childIds.indexOf('crop-mark-1');
    expect(cropMarkIndex).toBeGreaterThan(dieIndex);

    // 8. generateCutFile ignores White_Layer and Cmyk_art_Layer
    const serializer = new XMLSerializer();
    const cutSvgString = generateCutFile(serializer.serializeToString(organized), cutSettings);
    expect(cutSvgString).not.toContain('White_Layer');
    expect(cutSvgString).not.toContain('sticker1.png');
    expect(cutSvgString).not.toContain('sticker2.png');
  });
});
