
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

        // Call init to attach listeners (if necessary, but we can also trigger the logic if we could access it)
        // Since handleExportPdf is not exported, we rely on init attaching the listener.
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
        expect(mockZipFile).toHaveBeenCalledWith('nested-stickers-300dpi.pdf', expect.any(Blob));
        expect(mockZipGenerateAsync).toHaveBeenCalled();
    });

    test('should show error if no nested SVG', async () => {
        window.nestedSvgs = [];
        const btn = document.getElementById('exportPdfBtn');
        btn.click();

        expect(jsPDFMock).not.toHaveBeenCalled();
        // Check if error toast is shown (checking class removal)
        const errorToast = document.getElementById('error-toast');
        // The toast is visible when opacity-0 is removed
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
});
