
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
global.XMLSerializer = dom.window.XMLSerializer;
global.DOMParser = dom.window.DOMParser;
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

const jsPDFMock = jest.fn(() => ({
    save: jest.fn(),
}));

const SVGtoPDFMock = jest.fn();

// Use unstable_mockModule for ESM dependencies
jest.unstable_mockModule('jspdf', () => ({
    jsPDF: jsPDFMock,
}));

jest.unstable_mockModule('svg-to-pdfkit', () => ({
    default: SVGtoPDFMock,
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
            <div id="success-toast" class="hidden"></div>
            <span id="success-message"></span>
            <div id="error-toast" class="hidden"></div>
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

        // Mock window.nestedSvg
        window.nestedSvg = '<svg width="100" height="100"><rect x="0" y="0" width="100" height="100"/></svg>';

        // Import the module dynamically to ensure mocks are applied
        printshop = await import('../../src/printshop.js');

        // Call init to attach listeners (if necessary, but we can also trigger the logic if we could access it)
        // Since handleExportPdf is not exported, we rely on init attaching the listener.
        await printshop.init();
    });

    test('should call jsPDF and SVGtoPDF when export button is clicked', async () => {
        const btn = document.getElementById('exportPdfBtn');
        btn.click();

        expect(jsPDFMock).toHaveBeenCalledWith({
            unit: 'px',
            format: [100, 100]
        });
        expect(SVGtoPDFMock).toHaveBeenCalled();

        // Verify save was called on the doc instance
        const docInstance = jsPDFMock.mock.results[0].value;
        expect(docInstance.save).toHaveBeenCalledWith('nested-stickers.pdf');
    });

    test('should show error if no nested SVG', async () => {
        window.nestedSvg = null;
        const btn = document.getElementById('exportPdfBtn');
        btn.click();

        expect(jsPDFMock).not.toHaveBeenCalled();
        // Check if error toast is shown (checking class removal)
        const errorToast = document.getElementById('error-toast');
        expect(errorToast.classList.contains('hidden')).toBe(false);
        expect(document.getElementById('error-message').textContent).toBe('No nested SVG to export.');
    });

    test('should show error for invalid dimensions', async () => {
        window.nestedSvg = '<svg width="0" height="0"></svg>';
        const btn = document.getElementById('exportPdfBtn');
        btn.click();

        expect(jsPDFMock).not.toHaveBeenCalled();
         const errorToast = document.getElementById('error-toast');
        expect(errorToast.classList.contains('hidden')).toBe(false);
        expect(document.getElementById('error-message').textContent).toBe('Invalid SVG dimensions for PDF export.');
    });
});
