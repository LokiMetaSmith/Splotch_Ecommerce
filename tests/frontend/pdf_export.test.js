
import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost/',
});
global.document = dom.window.document;
global.window = dom.window;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLAnchorElement = dom.window.HTMLAnchorElement;
global.Node = dom.window.Node;
global.URL = dom.window.URL;
global.Blob = dom.window.Blob;
class MockImage {
    constructor() {
        setTimeout(() => {
            if (this.onload) this.onload();
        }, 0);
    }
}
global.Image = MockImage;
global.XMLSerializer = dom.window.XMLSerializer;
global.DOMParser = dom.window.DOMParser;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    fillRect: jest.fn(),
    drawImage: jest.fn(),
    scale: jest.fn(),
}));
HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/jpeg;base64,mocked');
HTMLCanvasElement.prototype.toBlob = jest.fn((cb) => cb(new Blob(['mocked'])));
global.Text = dom.window.Text;

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock;

// Mock URL.createObjectURL and revokeObjectURL
global.URL.createObjectURL = jest.fn();
global.URL.revokeObjectURL = jest.fn();

const docMock = {
    save: jest.fn(),
    svg: jest.fn(() => Promise.resolve()),
    addImage: jest.fn(),
    output: jest.fn(() => new Blob(['pdf-data'])),
    addPage: jest.fn(),
};

const jsPDFMock = jest.fn(() => docMock);

// Use unstable_mockModule for ESM dependencies
jest.unstable_mockModule('jspdf', () => ({
    jsPDF: jsPDFMock,
}));

jest.unstable_mockModule('svg2pdf.js', () => ({
    default: jest.fn(),
}));

const mockZipFile = jest.fn();
const mockZipGenerateAsync = jest.fn(() => Promise.resolve(new Blob(['mock-zip'])));
jest.unstable_mockModule('jszip', () => ({
    default: jest.fn().mockImplementation(() => ({
        file: mockZipFile,
        generateAsync: mockZipGenerateAsync,
    }))
}));

// Mock other dependencies
jest.unstable_mockModule('/src/styles.css', () => ({}));
jest.unstable_mockModule('@simplewebauthn/browser', () => ({
    startRegistration: jest.fn(),
    startAuthentication: jest.fn(),
}));

// DOMPurify needs a default export
jest.unstable_mockModule('dompurify', () => ({
    default: {
        sanitize: jest.fn(str => str),
    },
}));

// These modules are imported in src/printshop.js with named exports
jest.unstable_mockModule('../../src/lib/svgnest.js', () => ({
    SvgNest: class {},
}));
jest.unstable_mockModule('../../src/lib/svgparser.js', () => ({
    SVGParser: class {},
}));
jest.unstable_mockModule('jose', () => ({
    createRemoteJWKSet: jest.fn(),
}));

describe('PDF Export Functionality', () => {
    let printshop;

    beforeEach(async () => {
        jest.clearAllMocks();
        // Setup mocks for fetch which is called in init
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ serverSessionToken: 'test-token', csrfToken: 'test-csrf' }),
            headers: new Map(),
        }));

        document.body.innerHTML = `
            <div id="exportPdfBtn"></div>
            <div id="downloadPdfBtn"></div>
            <div id="downloadXmlBtn"></div>
            <div id="success-toast" class="opacity-0 translate-y-full pointer-events-none"></div>
            <span id="success-message"></span>
            <div id="error-toast" class="opacity-0 translate-y-full pointer-events-none"></div>
            <span id="error-message"></span>
            <div id="orders-list"></div>
            <p id="no-orders-message"></p>
            <div id="filter-container"></div>
            <div id="connection-status-dot"></div>
            <div id="connection-status-text"></div>
            <div id="auth-status"></div>
            <button id="loginBtn"></button>
            <button id="registerBtn"></button>
            <div id="loading-indicator" class="hidden"></div>
        `;

        // Mock window.nestedSvgs
        window.nestedSvgs = ['<svg width="100" height="100"><rect x="0" y="0" width="100" height="100"/></svg>'];

        // Import the module dynamically to ensure mocks are applied
        printshop = await import('../../src/printshop.js');

        // Call init to attach listeners
        await printshop.init();
    });

    test('should call jsPDF, render canvas, and zip when export button is clicked', async () => {
        const btn = document.getElementById('exportPdfBtn');
        btn.click();

        // Wait for async operations to complete
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(jsPDFMock).toHaveBeenCalledWith({
            unit: 'px',
            format: [100, 100]
        });

        const docInstance = jsPDFMock.mock.results[0].value;
        expect(docInstance.addImage).toHaveBeenCalledWith('data:image/jpeg;base64,mocked', 'JPEG', 0, 0, 100, 100);

        // Verify zip operations
        expect(mockZipFile).toHaveBeenCalledWith('nested-stickers-300dpi.png', expect.any(Blob));
        expect(mockZipFile).toHaveBeenCalledWith('nested-stickers-PrintOnly.pdf', expect.any(Blob));
        expect(mockZipFile).toHaveBeenCalledWith('nested-stickers-VinylMaster-PrintCut.pdf', expect.any(Blob));
        expect(mockZipGenerateAsync).toHaveBeenCalled();
    });

    test('should download PDF directly when downloadPdfBtn is clicked', async () => {
        const btn = document.getElementById('downloadPdfBtn');
        btn.click();

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(jsPDFMock).toHaveBeenCalledWith(expect.objectContaining({
            unit: 'px',
            format: [100, 100],
        }));

        expect(docMock.save).toHaveBeenCalledWith('nested-stickers-sheet1.pdf');
    });

    test('should show error if downloadPdfBtn clicked with no nested SVG', async () => {
        window.nestedSvgs = [];
        const btn = document.getElementById('downloadPdfBtn');
        btn.click();

        const errorToast = document.getElementById('error-toast');
        expect(errorToast.classList.contains('opacity-0')).toBe(false);
        expect(document.getElementById('error-message').textContent).toBe('No nested SVG sheets to generate a PDF from.');
    });

    test('should show error if no nested SVG on exportPdfBtn', async () => {
        window.nestedSvgs = [];
        const btn = document.getElementById('exportPdfBtn');
        btn.click();

        expect(jsPDFMock).not.toHaveBeenCalled();
        const errorToast = document.getElementById('error-toast');
        expect(errorToast.classList.contains('opacity-0')).toBe(false);
        expect(document.getElementById('error-message').textContent).toBe('No nested SVG sheets to export.');
    });

    test('should show error for invalid dimensions', async () => {
        window.nestedSvgs = ['<svg width="0" height="0"></svg>'];
        const btn = document.getElementById('exportPdfBtn');
        btn.click();

        expect(jsPDFMock).not.toHaveBeenCalled();
        const errorToast = document.getElementById('error-toast');
        expect(errorToast.classList.contains('opacity-0')).toBe(false);
        expect(document.getElementById('error-message').textContent).toBe('Invalid SVG dimensions for PDF export on sheet 1');
    });

    test('prepareVectorPrintCutSvg should preserve transforms and data-scale for nested cutlines', () => {
        const svgString = `
            <svg width="800" height="600" viewBox="0 0 800 600">
                <circle cx="60" cy="60" r="12" fill="black" />
                <g class="nest-group" transform="translate(200 150) rotate(30)" data-scale="0.75">
                    <image href="data:image/png;base64,mock" width="200" height="200" />
                    <g id="Kiss-Cut" class="cut-line-element">
                        <path d="M 0 0 L 200 0 L 200 200 Z" />
                    </g>
                    <g id="Die-Cut" class="cut-line-element">
                        <path d="M -10 -10 L 210 -10 L 210 210 Z" />
                    </g>
                </g>
            </svg>
        `;
        const parser = new DOMParser();
        const svgEl = parser.parseFromString(svgString, 'image/svg+xml').documentElement;

        const prepared = printshop.prepareVectorPrintCutSvg(svgEl, 'CutContour', '#FF00FF');

        // Image remains inside nest-group with its transform
        const nestGroup = prepared.querySelector('.nest-group');
        expect(nestGroup).toBeTruthy();
        expect(nestGroup.getAttribute('transform')).toBe('translate(200 150) rotate(30)');
        expect(nestGroup.querySelector('image')).toBeTruthy();

        // CutContour layer exists
        const cutLayer = prepared.querySelector('#CutContour');
        expect(cutLayer).toBeTruthy();
        expect(cutLayer.getAttribute('data-name')).toBe('CutContour');

        // Cut layer contains subgroup with exact same transform and data-scale
        const cutSubGroup = cutLayer.querySelector('g[transform="translate(200 150) rotate(30)"]');
        expect(cutSubGroup).toBeTruthy();
        expect(cutSubGroup.getAttribute('data-scale')).toBe('0.75');

        // All paths inside cut layer have #FF00FF stroke, fill none, stroke-width 1
        const cutPaths = cutSubGroup.querySelectorAll('path');
        expect(cutPaths.length).toBe(2);
        cutPaths.forEach(p => {
            expect(p.getAttribute('stroke')).toBe('#FF00FF');
            expect(p.getAttribute('stroke-width')).toBe('1');
            expect(p.getAttribute('fill')).toBe('none');
        });
    });
});

