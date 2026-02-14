
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
global.Uint8Array = dom.window.Uint8Array;
global.btoa = dom.window.btoa;
global.atob = dom.window.atob;

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

// Mocks for dependencies
const startRegistrationMock = jest.fn();
const startAuthenticationMock = jest.fn();

jest.unstable_mockModule('@simplewebauthn/browser', () => ({
    startRegistration: startRegistrationMock,
    startAuthentication: startAuthenticationMock,
}));

jest.unstable_mockModule('jose', () => ({
    createRemoteJWKSet: jest.fn(() => () => Promise.resolve()),
    jwtVerify: jest.fn(),
}));

jest.unstable_mockModule('jspdf', () => ({
    jsPDF: jest.fn(),
}));

jest.unstable_mockModule('svg-to-pdfkit', () => ({
    default: jest.fn(),
}));

jest.unstable_mockModule('/src/styles.css', () => ({}));

// DOMPurify needs a default export
jest.unstable_mockModule('dompurify', () => ({
    default: {
        sanitize: jest.fn(str => str),
    },
}));

// Mock internal libs
jest.unstable_mockModule('../../src/lib/svgnest.js', () => ({
    SvgNest: class {},
}));
jest.unstable_mockModule('../../src/lib/svgparser.js', () => ({
    SVGParser: class {},
}));
jest.unstable_mockModule('../../src/lib/cut_file_generator.js', () => ({
    generateCutFile: jest.fn(),
}));


describe('WebAuthn Functionality Reproduction', () => {
    let printshop;
    const mockOpts = { challenge: 'mock-challenge' };

    beforeEach(async () => {
        jest.clearAllMocks();
        localStorageMock.getItem.mockReturnValue('mock-auth-token'); // Pretend user is logged in for some actions? No, we test login/registration.

        // Setup DOM
        document.body.innerHTML = `
            <input id="username-input" value="testuser" />
            <button id="webauthn-register-btn"></button>
            <button id="webauthn-login-btn"></button>
            <div id="loading-indicator" class="hidden"></div>
            <div id="error-toast" class="opacity-0 translate-y-full pointer-events-none"></div>
            <span id="error-message"></span>
            <div id="success-toast" class="opacity-0 translate-y-full pointer-events-none"></div>
            <span id="success-message"></span>
            <div id="auth-status"></div>
            <button id="loginBtn"></button>
            <button id="registerBtn"></button>
            <div id="orders-list"></div>
            <p id="no-orders-message"></p>
            <div id="connection-status-dot"></div>
            <div id="connection-status-text"></div>
        `;

        // Mock fetch
        global.fetch = jest.fn((url, options) => {
            if (url.includes('/api/auth/pre-register')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockOpts),
                    headers: new Map(),
                });
            }
            if (url.includes('/api/auth/register-verify')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ verified: true }),
                    headers: new Map(),
                });
            }
            if (url.includes('/api/auth/login-options')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockOpts),
                    headers: new Map(),
                });
            }
            if (url.includes('/api/auth/login-verify')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ verified: true, token: 'mock-jwt-token' }),
                    headers: new Map(),
                });
            }
            // Default mock for init calls
            if (url.includes('/api/server-info')) {
                return Promise.resolve({
                     ok: true,
                     json: () => Promise.resolve({ serverSessionToken: 'test-token' }),
                     headers: new Map(),
                });
            }
            if (url.includes('/api/csrf-token')) {
                 return Promise.resolve({
                     ok: true,
                     json: () => Promise.resolve({ csrfToken: 'test-csrf' }),
                     headers: new Map(),
                });
            }

            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({}),
                headers: new Map(),
            });
        });

        // Import the module dynamically
        printshop = await import('../../src/printshop.js');
        // Manually trigger init to bind events
        await printshop.init();
    });

    test('should call startRegistration with correct options structure', async () => {
        const regRespMock = {
            id: 'mock-id',
            rawId: new Uint8Array([1, 2, 3]),
            response: {
                clientDataJSON: new Uint8Array([4, 5, 6]),
                attestationObject: new Uint8Array([7, 8, 9]),
            },
            type: 'public-key',
        };
        startRegistrationMock.mockResolvedValue(regRespMock);

        const btn = document.getElementById('webauthn-register-btn');
        btn.click();

        // Wait for async actions
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(startRegistrationMock).toHaveBeenCalled();
        // The fix will make this pass:
        // expect(startRegistrationMock).toHaveBeenCalledWith({ optionsJSON: mockOpts });

        // Before fix, it was called with mockOpts directly:
        // expect(startRegistrationMock).toHaveBeenCalledWith(mockOpts);

        // Since we want to reproduce the issue (fail correctly or verify expected call),
        // let's assert what we WANT it to be called with.
        expect(startRegistrationMock).toHaveBeenCalledWith({ optionsJSON: mockOpts });
    });

    test('should call startAuthentication with correct options structure', async () => {
        const authRespMock = {
            id: 'mock-id',
            rawId: new Uint8Array([1, 2, 3]),
            response: {
                clientDataJSON: new Uint8Array([4, 5, 6]),
                authenticatorData: new Uint8Array([7, 8, 9]),
                signature: new Uint8Array([10, 11, 12]),
                userHandle: new Uint8Array([13, 14, 15]),
            },
            type: 'public-key',
        };
        startAuthenticationMock.mockResolvedValue(authRespMock);

        const btn = document.getElementById('webauthn-login-btn');
        btn.click();

        // Wait for async actions
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(startAuthenticationMock).toHaveBeenCalled();
        expect(startAuthenticationMock).toHaveBeenCalledWith({ optionsJSON: mockOpts });
    });
});
